import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#FBF9F4",
        text: "#2A2724",
        coral: "#E85D24",
        purple: "#7F77DD",
        amber: "#D4A847",
        teal: "#3AAFA9",
        muted: "#9A9590",
        border: "#E8E4DC",
      },
      fontFamily: {
        serif: ["Fraunces", "Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
  safelist: [
    "bg-tier-inner-circle",
    "bg-tier-genuine-friend",
    "bg-tier-trusted-confidant",
    "bg-tier-comedy-soulmate",
    "bg-tier-beloved-acquaintance",
    "bg-tier-cherished-visitor",
    "bg-tier-honored-guest",
    "tier-inner-circle",
    "tier-genuine-friend",
    "tier-trusted-confidant",
    "tier-comedy-soulmate",
    "tier-beloved-acquaintance",
    "tier-cherished-visitor",
    "tier-honored-guest",
    "era-late-night-nbc",
    "era-tonight-show",
    "era-tbs-conan",
    "era-podcast",
    "era-conan-must-go",
  ],
};
export default config;
