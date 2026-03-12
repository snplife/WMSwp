import { clampInteger, sendJson, sendMethodNotAllowed } from "../_lib/http.js";

const RUZ_BASE_URL = "https://www.registeruz.sk/cruz-public";

function buildIcDph(dic) {
  const normalizedDic = String(dic || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/^SK/i, "");
  return normalizedDic ? `SK${normalizedDic}` : "";
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function buildAddress(detail) {
  const street = String(detail?.ulica || "").trim();
  const postalCode = String(detail?.psc || "").trim();
  const city = String(detail?.mesto || "").trim();
  const parts = [street, [postalCode, city].filter(Boolean).join(" ")].filter(Boolean);

  return {
    street,
    postal_code: postalCode,
    city,
    formatted: parts.join(", ")
  };
}

async function fetchRegistryJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Registry request failed with status ${response.status}.`);
  }

  return response.json();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res, ["GET"]);
  }

  try {
    const id = String(req.query.id || "").trim();
    const query = String(req.query.q || "").trim();
    const limit = clampInteger(req.query.limit, { fallback: 8, min: 1, max: 10 });

    if (id) {
      const detail = await fetchRegistryJson(`${RUZ_BASE_URL}/api/uctovna-jednotka?id=${encodeURIComponent(id)}`);
      const address = buildAddress(detail);

      return sendJson(res, 200, {
        ok: true,
        item: {
          id: String(detail?.id || id),
          name: String(detail?.nazovUJ || "").trim(),
          ico: String(detail?.ico || "").trim(),
          dic: String(detail?.dic || "").trim(),
          ic_dph: buildIcDph(detail?.dic),
          address,
          source: "registeruz"
        }
      });
    }

    if (query.length < 3) {
      return sendJson(res, 200, {
        ok: true,
        items: []
      });
    }

    const suggestions = await fetchRegistryJson(
      `${RUZ_BASE_URL}/domain/suggestion/search?query=${encodeURIComponent(query)}`
    );

    const items = Array.isArray(suggestions)
      ? suggestions.slice(0, limit).map((item) => ({
          id: String(item?.id || "").trim(),
          name: decodeHtml(item?.entityName),
          ico: String(item?.entNumber || "").trim(),
          dic: String(item?.taxNumber || "").trim(),
          ic_dph: buildIcDph(item?.taxNumber)
        }))
      : [];

    return sendJson(res, 200, {
      ok: true,
      query,
      items
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
