import { randomBytes } from "node:crypto";
import { readPublication } from "./data/publications";
import { PUBLIC_HEADERS, publicationFailure, publicationQuery } from "./publication";

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** A route response avoids the private app layout and never serialises a tenant or session. */
export async function publicHtml(request: Request, id: string, embed: boolean): Promise<Response> {
  try {
    const query = publicationQuery(new URL(request.url), embed);
    const { listing, origins } = await readPublication(id, query.revision);
    const nonce = randomBytes(18).toString("base64");
    const dark = query.theme === "dark";
    const body = `<h1>${escapeHtml(listing.title)}</h1><p>${escapeHtml(listing.description)}</p>` +
      listing.images.map(image => `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}" width="${image.width}" height="${image.height}" loading="lazy">`).join("");
    const script = embed ? `
      const allowed=[...${JSON.stringify(origins)},location.origin],publicationId=${JSON.stringify(id)},revision=${JSON.stringify(listing.revision)};
      function send(type){ const height=Math.min(1600,Math.max(240,Math.ceil(document.documentElement.scrollHeight))); for(const origin of allowed) parent.postMessage({version:1,type,publicationId,revision,height,...(type==='taptap3d:unavailable'?{code:'publication_withdrawn'}:{})},origin); }
      new ResizeObserver(()=>send('taptap3d:resize')).observe(document.body);
      addEventListener('load',()=>send('taptap3d:ready')); send('taptap3d:ready');
      setInterval(async()=>{try{const r=await fetch(${JSON.stringify(`/v1/publications/${id}?revision=${listing.revision}`)},{cache:'no-store'});if(r.status===410||r.status===404){document.querySelector('main').textContent='This listing is no longer available.';send('taptap3d:unavailable');}}catch{}},30000);` : "";
    return new Response(`<!doctype html><html lang="${listing.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(listing.title)}</title><link rel="canonical" href="${escapeHtml(listing.canonicalUrl)}"><style nonce="${nonce}">:root{color-scheme:${dark ? "dark" : "light"}}body{margin:0;background:${dark ? "#010736" : "#f9f9f9"};color:${dark ? "#f9f9f9" : "#010736"};font:16px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}main{max-width:760px;margin:auto;padding:24px}h1{font-size:28px;line-height:1.2}p{white-space:pre-wrap}img{display:block;max-width:100%;height:auto;margin-top:20px}</style></head><body><main>${body}</main>${script ? `<script nonce="${nonce}">${script}</script>` : ""}</body></html>`, {
      headers: { ...PUBLIC_HEADERS, "Content-Type": "text/html; charset=utf-8", "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": `default-src 'none'; img-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors ${embed ? ["'self'", ...origins].join(" ") : "'none'"}` },
    });
  } catch (error) { return publicationFailure(error); }
}
