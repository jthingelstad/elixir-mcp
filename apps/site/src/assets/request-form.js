/**
 * Access-request form (moved out of index.njk 2026-09-07, issue #25).
 *
 * It lives in its own file because the site now ships a Content
 * Security Policy with no script-src 'unsafe-inline': an inline
 * <script> would simply not run. Behaviour is unchanged - progressive
 * enhancement is not available here (there is no non-JS POST target),
 * so it fails loudly rather than swallowing a submission.
 */
(function () {
  const form = document.getElementById("request-form");
  const error = document.getElementById("request-error");
  const sent = document.getElementById("request-sent");
  if (!form) return;
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    error.hidden = true;
    const data = Object.fromEntries(new FormData(form).entries());
    const fail = function (message) {
      error.textContent = message;
      error.hidden = false;
    };
    try {
      const res = await fetch("/api/request-access", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-elixir-client": "web",
        },
        body: JSON.stringify(data),
      });
      const text = await res.text();
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch (parseError) {
        // Every /api route answers JSON. Anything else came from in
        // FRONT of the API and must never read as success.
        return fail("Something went wrong — try again.");
      }
      if (!res.ok) {
        return fail(
          body.error === "invalid_tag"
            ? "That doesn't look like a CR tag."
            : body.error === "rate_limited"
              ? "Too many requests — try again shortly."
              : "Something went wrong — try again.",
        );
      }
      form.hidden = true;
      sent.hidden = false;
    } catch (networkError) {
      fail("Something went wrong — try again.");
    }
  });
})();
