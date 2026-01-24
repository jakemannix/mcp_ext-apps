/**
 * Archive.org Search
 *
 * Searches archive.org for arcade/emulation games with smart fallbacks
 * for underscores, spaces, and partial matches.
 */

export interface ArchiveOrgSearchResult {
  identifier: string;
  title: string;
  mediatype: string;
  description?: string;
  year?: string;
  creator?: string;
}

interface ArchiveOrgSearchResponse {
  response: {
    docs: ArchiveOrgSearchResult[];
    numFound: number;
  };
}

const GAME_COLLECTIONS = [
  "collection:internetarcade",
  "collection:consolelivingroom",
  "collection:softwarelibrary_msdos_games",
  "collection:atari_2600_library",
  "collection:tosec",
  "collection:emularity_engine_jsmess",
].join(" OR ");

/**
 * Searches archive.org for arcade games matching the given term.
 */
export async function searchArchiveOrgGames(
  searchTerm: string,
  maxResults: number = 10,
): Promise<ArchiveOrgSearchResult[]> {
  const normalizedTerm = searchTerm.trim();
  const termWithSpaces = normalizedTerm.replace(/_/g, " ");
  const termWithUnderscores = normalizedTerm.replace(/\s+/g, "_");
  const words = normalizedTerm.split(/[_\s]+/).filter((w) => w.length > 0);

  const exactVariations = [
    normalizedTerm,
    termWithSpaces,
    termWithUnderscores,
  ].filter((term, index, self) => term && self.indexOf(term) === index);

  const exactQuery = `(${exactVariations.join(" OR ")})`;

  // Step 1: Search with exact terms in game collections
  let games = await performSearch(exactQuery, true, maxResults);

  // Step 2: Broader search with individual words
  if (games.length === 0 && words.length > 1) {
    const broaderQuery = `(${exactVariations.join(" OR ")} OR ${words.join(" OR ")})`;
    games = await performSearch(broaderQuery, true, maxResults);
  }

  // Step 3: Search without collection filter as final fallback
  if (games.length === 0) {
    const fallbackQuery =
      words.length > 1
        ? `(${exactVariations.join(" OR ")} OR ${words.join(" OR ")})`
        : exactQuery;

    try {
      games = await performSearch(fallbackQuery, false, maxResults);
      games = games.filter(
        (doc) =>
          doc.identifier.startsWith("arcade_") ||
          doc.identifier.startsWith("msdos_") ||
          doc.identifier.includes("game") ||
          doc.mediatype === "software",
      );
    } catch {
      // Continue with empty results
    }
  }

  return games;
}

async function performSearch(
  query: string,
  withCollectionFilter: boolean,
  maxResults: number,
): Promise<ArchiveOrgSearchResult[]> {
  const fullQuery = withCollectionFilter
    ? `${query} AND (${GAME_COLLECTIONS})`
    : query;

  const params = new URLSearchParams({
    q: fullQuery,
    "fl[]": "identifier,title,mediatype,description,year,creator",
    output: "json",
    rows: String(maxResults),
  });

  // fl[] needs multiple values, URLSearchParams doesn't handle this well
  const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(fullQuery)}&fl[]=identifier&fl[]=title&fl[]=mediatype&fl[]=description&fl[]=year&fl[]=creator&output=json&rows=${encodeURIComponent(String(maxResults))}`;

  const response = await fetch(searchUrl, {
    headers: {
      "User-Agent": "MCP-Arcade-Server/1.0",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Archive.org API returned status ${response.status}`);
  }

  const data = (await response.json()) as ArchiveOrgSearchResponse;
  if (!data?.response?.docs) return [];

  return data.response.docs.filter((doc) => doc.identifier);
}
