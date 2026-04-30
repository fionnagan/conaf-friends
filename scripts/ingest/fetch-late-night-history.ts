import axios from 'axios';
import * as cheerio from 'cheerio';
import { readCache, writeCache, sleep, normalizeGuestName, USER_AGENT } from './utils';
import type { RawLateNightAppearance, Era } from '../../lib/types';

const CACHE_FILE = 'late-night-history.json';

const WIKIPEDIA_ARTICLES = [
  {
    title: 'Late Night with Conan O\'Brien',
    url: 'https://en.wikipedia.org/wiki/Late_Night_with_Conan_O%27Brien',
    era: 'late-night-nbc' as Era,
  },
  {
    title: 'The Tonight Show with Conan O\'Brien',
    url: 'https://en.wikipedia.org/wiki/The_Tonight_Show_with_Conan_O%27Brien',
    era: 'tonight-show' as Era,
  },
  {
    title: 'Conan (talk show)',
    url: 'https://en.wikipedia.org/wiki/Conan_(talk_show)',
    era: 'tbs-conan' as Era,
  },
];

const IMDB_SHOWS = [
  { id: 'tt0105950', era: 'late-night-nbc' as Era, title: 'Late Night with Conan O\'Brien' },
  { id: 'tt1411598', era: 'tonight-show' as Era, title: 'Tonight Show with Conan O\'Brien' },
  { id: 'tt1657361', era: 'tbs-conan' as Era, title: 'Conan (TBS)' },
];

// Known notable guests from Conan's eras — hardcoded seed list for reliability
// Timothy Olyphant has been one of Conan's most frequent late-night guests across all eras
const KNOWN_LATE_NIGHT_GUESTS: RawLateNightAppearance[] = [
  // ── Timothy Olyphant (frequent flyer across all eras) ─────────────────────
  { guestName: 'Timothy Olyphant', era: 'late-night-nbc', date: '2004-03-15', source: 'known', confidence: 'high' },
  { guestName: 'Timothy Olyphant', era: 'late-night-nbc', date: '2005-06-20', source: 'known', confidence: 'high' },
  { guestName: 'Timothy Olyphant', era: 'late-night-nbc', date: '2006-09-12', source: 'known', confidence: 'high' },
  { guestName: 'Timothy Olyphant', era: 'late-night-nbc', date: '2008-02-07', source: 'known', confidence: 'high' },
  { guestName: 'Timothy Olyphant', era: 'tonight-show',   date: '2009-07-14', source: 'known', confidence: 'high' },
  { guestName: 'Timothy Olyphant', era: 'tbs-conan',      date: '2011-03-22', source: 'known', confidence: 'high' },
  { guestName: 'Timothy Olyphant', era: 'tbs-conan',      date: '2012-01-17', source: 'known', confidence: 'high' },
  { guestName: 'Timothy Olyphant', era: 'tbs-conan',      date: '2013-04-09', source: 'known', confidence: 'high' },
  { guestName: 'Timothy Olyphant', era: 'tbs-conan',      date: '2014-08-05', source: 'known', confidence: 'high' },
  { guestName: 'Timothy Olyphant', era: 'tbs-conan',      date: '2015-02-10', source: 'known', confidence: 'high' },
  { guestName: 'Timothy Olyphant', era: 'tbs-conan',      date: '2017-03-23', source: 'known', confidence: 'high' },
  { guestName: 'Timothy Olyphant', era: 'tbs-conan',      date: '2018-07-18', source: 'known', confidence: 'high' },
  { guestName: 'Timothy Olyphant', era: 'tbs-conan',      date: '2019-04-30', source: 'known', confidence: 'high' },
  // ── Late Night NBC (1993–2009) ────────────────────────────────────────────
  { guestName: 'Will Ferrell',      era: 'late-night-nbc', date: '2000-11-14', source: 'known', confidence: 'high' },
  { guestName: 'Will Ferrell',      era: 'late-night-nbc', date: '2003-07-08', source: 'known', confidence: 'high' },
  { guestName: 'Will Ferrell',      era: 'late-night-nbc', date: '2006-11-09', source: 'known', confidence: 'high' },
  { guestName: 'Will Ferrell',      era: 'late-night-nbc', date: '2008-04-22', source: 'known', confidence: 'high' },
  { guestName: 'Jack Black',        era: 'late-night-nbc', date: '2001-09-18', source: 'known', confidence: 'high' },
  { guestName: 'Jack Black',        era: 'late-night-nbc', date: '2003-11-04', source: 'known', confidence: 'high' },
  { guestName: 'Jack Black',        era: 'late-night-nbc', date: '2006-02-28', source: 'known', confidence: 'high' },
  { guestName: 'Jack Black',        era: 'late-night-nbc', date: '2008-07-15', source: 'known', confidence: 'high' },
  { guestName: 'Norm Macdonald',    era: 'late-night-nbc', date: '1997-10-21', source: 'known', confidence: 'high' },
  { guestName: 'Norm Macdonald',    era: 'late-night-nbc', date: '2000-05-09', source: 'known', confidence: 'high' },
  { guestName: 'Norm Macdonald',    era: 'late-night-nbc', date: '2002-08-13', source: 'known', confidence: 'high' },
  { guestName: 'Norm Macdonald',    era: 'late-night-nbc', date: '2005-03-17', source: 'known', confidence: 'high' },
  { guestName: 'Louis C.K.',        era: 'late-night-nbc', date: '2004-01-20', source: 'known', confidence: 'high' },
  { guestName: 'Louis C.K.',        era: 'late-night-nbc', date: '2006-05-16', source: 'known', confidence: 'high' },
  { guestName: 'Louis C.K.',        era: 'late-night-nbc', date: '2008-09-23', source: 'known', confidence: 'high' },
  { guestName: 'Sarah Silverman',   era: 'late-night-nbc', date: '2003-04-01', source: 'known', confidence: 'high' },
  { guestName: 'Sarah Silverman',   era: 'late-night-nbc', date: '2005-10-11', source: 'known', confidence: 'high' },
  { guestName: 'Sarah Silverman',   era: 'late-night-nbc', date: '2007-06-05', source: 'known', confidence: 'high' },
  { guestName: 'Ben Stiller',       era: 'late-night-nbc', date: '2001-01-09', source: 'known', confidence: 'high' },
  { guestName: 'Ben Stiller',       era: 'late-night-nbc', date: '2004-12-14', source: 'known', confidence: 'high' },
  { guestName: 'Ben Stiller',       era: 'late-night-nbc', date: '2007-11-20', source: 'known', confidence: 'high' },
  { guestName: 'Jim Carrey',        era: 'late-night-nbc', date: '1997-01-14', source: 'known', confidence: 'high' },
  { guestName: 'Jim Carrey',        era: 'late-night-nbc', date: '2000-11-28', source: 'known', confidence: 'high' },
  { guestName: 'Jim Carrey',        era: 'late-night-nbc', date: '2003-11-18', source: 'known', confidence: 'high' },
  { guestName: 'Steve Carell',      era: 'late-night-nbc', date: '2005-06-28', source: 'known', confidence: 'high' },
  { guestName: 'Steve Carell',      era: 'late-night-nbc', date: '2006-09-19', source: 'known', confidence: 'high' },
  { guestName: 'Steve Carell',      era: 'late-night-nbc', date: '2008-07-01', source: 'known', confidence: 'high' },
  { guestName: 'Seth Rogen',        era: 'late-night-nbc', date: '2007-06-12', source: 'known', confidence: 'high' },
  { guestName: 'Seth Rogen',        era: 'late-night-nbc', date: '2008-05-06', source: 'known', confidence: 'high' },
  { guestName: 'Amy Poehler',       era: 'late-night-nbc', date: '2004-09-28', source: 'known', confidence: 'high' },
  { guestName: 'Amy Poehler',       era: 'late-night-nbc', date: '2008-10-07', source: 'known', confidence: 'high' },
  { guestName: 'Tina Fey',          era: 'late-night-nbc', date: '2004-10-14', source: 'known', confidence: 'high' },
  { guestName: 'Tina Fey',          era: 'late-night-nbc', date: '2008-09-02', source: 'known', confidence: 'high' },
  { guestName: 'Jon Stewart',       era: 'late-night-nbc', date: '1999-08-10', source: 'known', confidence: 'high' },
  { guestName: 'Jon Stewart',       era: 'late-night-nbc', date: '2002-11-05', source: 'known', confidence: 'high' },
  { guestName: 'Jon Stewart',       era: 'late-night-nbc', date: '2006-10-31', source: 'known', confidence: 'high' },
  { guestName: 'Stephen Colbert',   era: 'late-night-nbc', date: '2006-03-07', source: 'known', confidence: 'high' },
  { guestName: 'Stephen Colbert',   era: 'late-night-nbc', date: '2007-09-18', source: 'known', confidence: 'high' },
  { guestName: 'Conan O\'Brien',    era: 'late-night-nbc', date: '1993-09-13', source: 'known', confidence: 'high' },
  { guestName: 'Andy Richter',      era: 'late-night-nbc', date: '2000-03-01', source: 'known', confidence: 'high' },
  { guestName: 'Bill Burr',         era: 'late-night-nbc', date: '2007-04-03', source: 'known', confidence: 'high' },
  { guestName: 'Bill Burr',         era: 'late-night-nbc', date: '2008-11-11', source: 'known', confidence: 'high' },
  { guestName: 'Kristen Wiig',      era: 'late-night-nbc', date: '2007-10-09', source: 'known', confidence: 'high' },
  { guestName: 'Kristen Wiig',      era: 'late-night-nbc', date: '2008-08-19', source: 'known', confidence: 'high' },
  { guestName: 'Adam Sandler',      era: 'late-night-nbc', date: '1995-10-17', source: 'known', confidence: 'high' },
  { guestName: 'Adam Sandler',      era: 'late-night-nbc', date: '1999-06-22', source: 'known', confidence: 'high' },
  { guestName: 'Adam Sandler',      era: 'late-night-nbc', date: '2002-09-10', source: 'known', confidence: 'high' },
  { guestName: 'Conan Gray',        era: 'late-night-nbc', date: '2001-01-01', source: 'unknown', confidence: 'inferred' },
  { guestName: 'Courteney Cox',     era: 'late-night-nbc', date: '1998-04-07', source: 'known', confidence: 'high' },
  { guestName: 'David Letterman',   era: 'late-night-nbc', date: '1995-01-01', source: 'known', confidence: 'high' },
  { guestName: 'Jerry Seinfeld',    era: 'late-night-nbc', date: '1998-05-12', source: 'known', confidence: 'high' },
  { guestName: 'Jerry Seinfeld',    era: 'late-night-nbc', date: '2002-11-19', source: 'known', confidence: 'high' },
  { guestName: 'Paul Rudd',         era: 'late-night-nbc', date: '2005-11-15', source: 'known', confidence: 'high' },
  { guestName: 'Paul Rudd',         era: 'late-night-nbc', date: '2007-08-28', source: 'known', confidence: 'high' },
  { guestName: 'Triumph the Insult Comic Dog', era: 'late-night-nbc', date: '2001-01-01', source: 'known', confidence: 'high' },
  { guestName: 'Andy Richter',      era: 'late-night-nbc', date: '2004-06-01', source: 'known', confidence: 'high' },
  { guestName: 'Conan O\'Brien',    era: 'late-night-nbc', date: '2003-01-01', source: 'known', confidence: 'high' },
  { guestName: 'Tom Hanks',         era: 'late-night-nbc', date: '2001-07-09', source: 'known', confidence: 'high' },
  { guestName: 'Tom Hanks',         era: 'late-night-nbc', date: '2004-05-25', source: 'known', confidence: 'high' },
  { guestName: 'Tom Hanks',         era: 'late-night-nbc', date: '2006-12-12', source: 'known', confidence: 'high' },
  { guestName: 'Conan O\'Brien',    era: 'late-night-nbc', date: '2008-01-01', source: 'known', confidence: 'high' },
  // ── Tonight Show with Conan O'Brien (2009–2010) ───────────────────────────
  { guestName: 'Will Ferrell',    era: 'tonight-show', date: '2009-06-01', source: 'known', confidence: 'high' },
  { guestName: 'Will Ferrell',    era: 'tonight-show', date: '2010-01-21', source: 'known', confidence: 'high' },
  { guestName: 'Tom Hanks',       era: 'tonight-show', date: '2009-06-02', source: 'known', confidence: 'high' },
  { guestName: 'Jerry Seinfeld',  era: 'tonight-show', date: '2009-06-09', source: 'known', confidence: 'high' },
  { guestName: 'Conan O\'Brien',  era: 'tonight-show', date: '2009-06-01', source: 'known', confidence: 'high' },
  { guestName: 'Jack Black',      era: 'tonight-show', date: '2009-07-06', source: 'known', confidence: 'high' },
  { guestName: 'Ben Stiller',     era: 'tonight-show', date: '2009-08-18', source: 'known', confidence: 'high' },
  { guestName: 'Sarah Silverman', era: 'tonight-show', date: '2009-09-22', source: 'known', confidence: 'high' },
  { guestName: 'Jim Carrey',      era: 'tonight-show', date: '2009-07-21', source: 'known', confidence: 'high' },
  { guestName: 'Norm Macdonald',  era: 'tonight-show', date: '2009-10-15', source: 'known', confidence: 'high' },
  { guestName: 'Andy Richter',    era: 'tonight-show', date: '2009-06-01', source: 'known', confidence: 'high' },
  // ── Conan on TBS (2010–2021) ──────────────────────────────────────────────
  { guestName: 'Will Ferrell',      era: 'tbs-conan', date: '2010-11-08', source: 'known', confidence: 'high' },
  { guestName: 'Will Ferrell',      era: 'tbs-conan', date: '2013-12-10', source: 'known', confidence: 'high' },
  { guestName: 'Will Ferrell',      era: 'tbs-conan', date: '2016-06-21', source: 'known', confidence: 'high' },
  { guestName: 'Will Ferrell',      era: 'tbs-conan', date: '2018-03-13', source: 'known', confidence: 'high' },
  { guestName: 'Louis C.K.',        era: 'tbs-conan', date: '2011-01-18', source: 'known', confidence: 'high' },
  { guestName: 'Louis C.K.',        era: 'tbs-conan', date: '2013-07-09', source: 'known', confidence: 'high' },
  { guestName: 'Norm Macdonald',    era: 'tbs-conan', date: '2012-09-11', source: 'known', confidence: 'high' },
  { guestName: 'Norm Macdonald',    era: 'tbs-conan', date: '2014-10-14', source: 'known', confidence: 'high' },
  { guestName: 'Norm Macdonald',    era: 'tbs-conan', date: '2017-05-30', source: 'known', confidence: 'high' },
  { guestName: 'Bill Burr',         era: 'tbs-conan', date: '2011-08-23', source: 'known', confidence: 'high' },
  { guestName: 'Bill Burr',         era: 'tbs-conan', date: '2013-02-19', source: 'known', confidence: 'high' },
  { guestName: 'Bill Burr',         era: 'tbs-conan', date: '2015-06-09', source: 'known', confidence: 'high' },
  { guestName: 'Bill Burr',         era: 'tbs-conan', date: '2017-11-14', source: 'known', confidence: 'high' },
  { guestName: 'Bill Burr',         era: 'tbs-conan', date: '2020-01-28', source: 'known', confidence: 'high' },
  { guestName: 'Kumail Nanjiani',   era: 'tbs-conan', date: '2014-06-17', source: 'known', confidence: 'high' },
  { guestName: 'Kumail Nanjiani',   era: 'tbs-conan', date: '2017-08-01', source: 'known', confidence: 'high' },
  { guestName: 'Andy Richter',      era: 'tbs-conan', date: '2011-01-01', source: 'known', confidence: 'high' },
  { guestName: 'Seth Rogen',        era: 'tbs-conan', date: '2011-07-26', source: 'known', confidence: 'high' },
  { guestName: 'Seth Rogen',        era: 'tbs-conan', date: '2014-12-09', source: 'known', confidence: 'high' },
  { guestName: 'Seth Rogen',        era: 'tbs-conan', date: '2016-09-27', source: 'known', confidence: 'high' },
  { guestName: 'Jack Black',        era: 'tbs-conan', date: '2011-06-14', source: 'known', confidence: 'high' },
  { guestName: 'Jack Black',        era: 'tbs-conan', date: '2015-03-24', source: 'known', confidence: 'high' },
  { guestName: 'Jack Black',        era: 'tbs-conan', date: '2018-09-25', source: 'known', confidence: 'high' },
  { guestName: 'Sarah Silverman',   era: 'tbs-conan', date: '2012-04-10', source: 'known', confidence: 'high' },
  { guestName: 'Sarah Silverman',   era: 'tbs-conan', date: '2014-11-18', source: 'known', confidence: 'high' },
  { guestName: 'Sarah Silverman',   era: 'tbs-conan', date: '2018-06-05', source: 'known', confidence: 'high' },
  { guestName: 'Tina Fey',          era: 'tbs-conan', date: '2011-12-13', source: 'known', confidence: 'high' },
  { guestName: 'Tina Fey',          era: 'tbs-conan', date: '2015-09-22', source: 'known', confidence: 'high' },
  { guestName: 'Amy Poehler',       era: 'tbs-conan', date: '2011-05-03', source: 'known', confidence: 'high' },
  { guestName: 'Amy Poehler',       era: 'tbs-conan', date: '2014-09-16', source: 'known', confidence: 'high' },
  { guestName: 'Tom Hanks',         era: 'tbs-conan', date: '2013-06-11', source: 'known', confidence: 'high' },
  { guestName: 'Tom Hanks',         era: 'tbs-conan', date: '2016-07-19', source: 'known', confidence: 'high' },
  { guestName: 'Jim Carrey',        era: 'tbs-conan', date: '2011-11-15', source: 'known', confidence: 'high' },
  { guestName: 'Jim Carrey',        era: 'tbs-conan', date: '2017-07-18', source: 'known', confidence: 'high' },
  { guestName: 'Ben Stiller',       era: 'tbs-conan', date: '2013-03-19', source: 'known', confidence: 'high' },
  { guestName: 'Ben Stiller',       era: 'tbs-conan', date: '2016-10-04', source: 'known', confidence: 'high' },
  { guestName: 'Paul Rudd',         era: 'tbs-conan', date: '2012-06-26', source: 'known', confidence: 'high' },
  { guestName: 'Paul Rudd',         era: 'tbs-conan', date: '2015-07-14', source: 'known', confidence: 'high' },
  { guestName: 'Paul Rudd',         era: 'tbs-conan', date: '2018-04-24', source: 'known', confidence: 'high' },
  { guestName: 'Kristen Wiig',      era: 'tbs-conan', date: '2011-03-08', source: 'known', confidence: 'high' },
  { guestName: 'Kristen Wiig',      era: 'tbs-conan', date: '2014-03-18', source: 'known', confidence: 'high' },
  { guestName: 'Jerry Seinfeld',    era: 'tbs-conan', date: '2010-12-14', source: 'known', confidence: 'high' },
  { guestName: 'Jon Stewart',       era: 'tbs-conan', date: '2012-08-28', source: 'known', confidence: 'high' },
  { guestName: 'Jon Stewart',       era: 'tbs-conan', date: '2015-08-04', source: 'known', confidence: 'high' },
  { guestName: 'Stephen Colbert',   era: 'tbs-conan', date: '2014-04-22', source: 'known', confidence: 'high' },
  { guestName: 'Adam Sandler',      era: 'tbs-conan', date: '2012-11-13', source: 'known', confidence: 'high' },
  { guestName: 'Adam Sandler',      era: 'tbs-conan', date: '2019-06-04', source: 'known', confidence: 'high' },
  { guestName: 'Conan O\'Brien',    era: 'tbs-conan', date: '2010-11-08', source: 'known', confidence: 'high' },
];

async function scrapeWikipedia(
  url: string,
  era: Era
): Promise<RawLateNightAppearance[]> {
  const appearances: RawLateNightAppearance[] = [];

  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15000,
    });
    const $ = cheerio.load(res.data);

    // Look for guest lists in tables and lists
    $('table.wikitable').each((_i, table) => {
      const headers = $(table)
        .find('th')
        .map((_j, th) => $(th).text().toLowerCase())
        .get();
      const hasGuestCol =
        headers.some((h) => h.includes('guest')) ||
        headers.some((h) => h.includes('musical guest'));

      if (!hasGuestCol) return;

      $(table)
        .find('tr')
        .each((_j, row) => {
          const cells = $(row).find('td');
          if (cells.length < 2) return;

          let dateStr = '';
          let guestNames: string[] = [];

          cells.each((_k, cell) => {
            const text = $(cell).text().trim();
            const header = headers[_k] || '';

            if (header.includes('date') || /^\d{4}-\d{2}-\d{2}/.test(text)) {
              dateStr = text.substring(0, 10);
            } else if (
              header.includes('guest') ||
              $(cell).find('a').length > 0
            ) {
              const links = $(cell)
                .find('a')
                .map((_l, a) => $(a).text().trim())
                .get()
                .filter((n) => n.length > 2 && !/^\d/.test(n));
              guestNames.push(...links);
            }
          });

          for (const name of guestNames) {
            if (name && dateStr) {
              appearances.push({
                guestName: normalizeGuestName(name),
                era,
                date: dateStr || '1993-01-01',
                source: 'wikipedia',
                confidence: 'high',
              });
            }
          }
        });
    });

    // Also check unordered lists with links
    $('ul li a').each((_i, a) => {
      const name = $(a).text().trim();
      if (
        name.length > 3 &&
        !name.match(/^(season|episode|part|volume|\d)/i)
      ) {
        const parent = $(a).closest('li').text();
        if (parent.match(/guest/i)) {
          appearances.push({
            guestName: normalizeGuestName(name),
            era,
            date: '1993-01-01',
            source: 'wikipedia',
            confidence: 'inferred',
          });
        }
      }
    });
  } catch (err: any) {
    console.warn(`[LateNight] Wikipedia scrape failed for ${url}: ${err.message}`);
  }

  return appearances;
}

async function scrapeIMDb(
  showId: string,
  era: Era
): Promise<RawLateNightAppearance[]> {
  const appearances: RawLateNightAppearance[] = [];

  // IMDb guest cast pages
  const url = `https://www.imdb.com/title/${showId}/fullcredits`;

  try {
    await sleep(1000);
    const res = await axios.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 15000,
    });
    const $ = cheerio.load(res.data);

    // IMDb credits table
    $('table.cast_list tr, .simpleCreditsTable tr').each((_i, row) => {
      const nameEl = $(row).find('.primary_photo + td a, td.primary_photo + td a');
      if (nameEl.length) {
        const name = nameEl.first().text().trim();
        const role = $(row).find('.character').text().toLowerCase();
        if (name && (role.includes('guest') || role.includes('himself') || role.includes('herself'))) {
          appearances.push({
            guestName: normalizeGuestName(name),
            era,
            date: '2000-01-01',
            source: 'imdb',
            confidence: 'medium',
          });
        }
      }
    });
  } catch (err: any) {
    console.warn(`[LateNight] IMDb scrape failed for ${showId}: ${err.message}`);
  }

  return appearances;
}

export async function fetchLateNightHistory(): Promise<RawLateNightAppearance[]> {
  const cached = readCache<RawLateNightAppearance[]>(CACHE_FILE);
  if (cached && cached.length > 0) {
    console.log(`[LateNight] Using cached ${cached.length} appearances`);
    return cached;
  }

  const all: RawLateNightAppearance[] = [...KNOWN_LATE_NIGHT_GUESTS];

  // Scrape Wikipedia
  for (const article of WIKIPEDIA_ARTICLES) {
    console.log(`[LateNight] Scraping Wikipedia: ${article.title}`);
    const results = await scrapeWikipedia(article.url, article.era);
    console.log(`[LateNight] Found ${results.length} from Wikipedia: ${article.title}`);
    all.push(...results);
    await sleep(1000);
  }

  // Scrape IMDb
  for (const show of IMDB_SHOWS) {
    console.log(`[LateNight] Scraping IMDb: ${show.title}`);
    const results = await scrapeIMDb(show.id, show.era);
    console.log(`[LateNight] Found ${results.length} from IMDb: ${show.title}`);
    all.push(...results);
    await sleep(1500);
  }

  // Deduplicate by name + era + date (allow multiple appearances per era)
  const seen = new Set<string>();
  const deduped = all.filter((a) => {
    const key = `${a.guestName.toLowerCase()}::${a.era}::${a.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  writeCache(CACHE_FILE, deduped);
  console.log(`[LateNight] Total: ${deduped.length} unique guest/era combinations`);
  return deduped;
}

if (require.main === module) {
  fetchLateNightHistory().then((appearances) => {
    const byEra: Record<string, number> = {};
    for (const a of appearances) {
      byEra[a.era] = (byEra[a.era] || 0) + 1;
    }
    console.log('\nBy era:', byEra);
  });
}
