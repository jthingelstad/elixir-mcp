import { useState } from "react";

/**
 * A sent email, shown as it went out, in a frame that runs nothing:
 * same-origin so the frame can be sized to its content, links opening
 * in a new tab, no scripts (an archived mail carries none, and a frame
 * that could run one would be the one place in the console that does).
 * The API has already stripped the open pixel, so neither the person's
 * record nor the maintainer's counts as an open. Shared by the account
 * record (views/account/EmailRecord.jsx) and the admin queue.
 */
export function MailFrame({ html }) {
  const [height, setHeight] = useState(600);
  const doc = html.replace(/<head>/i, '<head><base target="_blank">');
  return (
    <iframe
      title="The email as it was sent"
      srcDoc={doc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className="block w-full border border-line rounded-[12px] bg-ground"
      style={{ height: `${height}px` }}
      onLoad={(ev) => {
        const h = ev.target.contentDocument?.documentElement?.scrollHeight;
        if (h) setHeight(h + 24);
      }}
    />
  );
}
