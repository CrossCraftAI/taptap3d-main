/**
 * A script that runs while the HTML is parsed, and only then.
 *
 * The shape is Next's own, from its guide on preventing flash before
 * hydration: on the server it is JavaScript and the browser executes it the
 * moment the parser reaches it — before first paint. On the client it renders
 * as plain text, so React neither warns about producing a script tag nor runs
 * it on a client-side navigation, where the component's own state is already
 * right. The type differs between the two renders, which is the one mismatch
 * suppressed here.
 *
 * The shell has no Content-Security-Policy of its own, so an inline script is
 * permitted; the preview document's policy (src/lib/render/html.ts) is a
 * different document and is untouched by this.
 */
export function InlineScript({ html }: { html: string }): React.ReactElement {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
