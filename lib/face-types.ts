export type PhotoDecision = 'auto_approved' | 'needs_review' | 'rejected';
export type ReviewDecision = 'approve' | 'reject';

// ── Face embedding layer ──────────────────────────────────────────────────────

export interface FaceEmbeddingResult {
  url: string;
  faceDetected: boolean;
  faceCount: number;
  embedding: number[] | null;
  error: string | null;
}

// ── Candidate images ──────────────────────────────────────────────────────────

export interface PhotoCandidate {
  url: string;
  sourceDomain: string;
  sourceTrust: number;
  faceEmbedding: number[] | null;
  faceDetected: boolean;
  faceCount: number;
}

export interface ScoredCandidate extends PhotoCandidate {
  faceScore: number;       // 0–1: face quality (single face, well-lit)
  embeddingScore: number;  // 0–1: consistency with cluster centroid
  nameMatchScore: number;  // 0–1: guest name present in URL/alt
  finalScore: number;      // weighted composite
}

// ── Identity confirmation ─────────────────────────────────────────────────────

export interface IdentityConfirmation {
  consistencyScore: number;    // average pairwise cosine similarity across embeddings
  dominantCluster: boolean;    // true if all images map to exactly 1 cluster
  clusterCount: number;
  centroidEmbedding: number[] | null;
}

// ── Enrichment decision ───────────────────────────────────────────────────────

export interface EnrichmentDecision {
  guestId: string;
  guestName: string;
  decision: PhotoDecision;
  selectedUrl: string | null;
  confidence: number;
  consistencyScore: number;
  candidates: ScoredCandidate[];
  rejectedReason?: string;
  decidedAt: string;
}

// ── Review queue + events ─────────────────────────────────────────────────────

export interface ReviewQueueItem {
  id: string;
  guestId: string;
  guestName: string;
  candidates: ScoredCandidate[];
  bestCandidate: ScoredCandidate;
  consistencyScore: number;
  createdAt: string;
}

export interface ReviewEvent {
  id: string;
  guestId: string;
  guestName: string;
  imageUrl: string;
  decision: ReviewDecision;
  reason?: string;
  faceScore: number;
  embeddingScore: number;
  source: string;
  confidence: number;
  reviewedAt: string;
}

// ── Source trust store ────────────────────────────────────────────────────────

export interface SourceTrustEntry {
  domain: string;
  score: number;         // [0.1, 1.0]
  approvals: number;
  rejections: number;
  embeddingThreshold: number;   // per-domain adaptive threshold
  lastUpdated: string;
}

export interface SourceTrustStore {
  [domain: string]: SourceTrustEntry;
}

// ── Calibration state ─────────────────────────────────────────────────────────

export interface CalibrationState {
  lastCalibrated: string;
  totalReviews: number;
  autoApprovalRate: number;
  falsePositiveRate: number;
}
