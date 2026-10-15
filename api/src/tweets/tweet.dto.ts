export interface TweetView {
  id: string;
  text: string;
  createdAt: string;
  author: { id: string; username: string; displayName: string };
}

// Raw SQL rows: node-postgres returns bigint columns as strings, which is
// exactly what clients need anyway. created_at arrives as an ISO-8601 string
// formatted by Postgres (see TWEET_COLUMNS).
export interface TweetRow extends Record<string, unknown> {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
  username: string;
  display_name: string;
}

export function toTweetView(row: TweetRow): TweetView {
  return {
    id: row.id,
    text: row.text,
    createdAt: row.created_at,
    author: {
      id: row.author_id,
      username: row.username,
      displayName: row.display_name,
    },
  };
}
