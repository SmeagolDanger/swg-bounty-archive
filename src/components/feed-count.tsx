import Link from "next/link";
import { connection } from "next/server";
import { getDiscordFeedCount } from "@/lib/data";

// Live count of Discord servers receiving the hunt feed, for the top bar.
// connection() keeps the value out of any statically prerendered page so it
// is always read at request time; the layout wraps this in Suspense.
export async function FeedCount() {
  await connection();
  const count = await getDiscordFeedCount();
  if (count < 1) return null;
  return <Link href="/stats" className="feed-count" title="Archive statistics">
    <i className="feed-dot" aria-hidden="true" />
    Hunt feed live in <b>{count.toLocaleString("en-US")}</b> Discord {count === 1 ? "server" : "servers"}
  </Link>;
}
