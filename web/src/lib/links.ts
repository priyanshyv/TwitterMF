// Twitter-style URLs: /<username>/status/<id>. The username is only for
// readability; the ID alone identifies the tweet.
export const tweetHref = (tweet: {
  id: string;
  author: { username: string };
}) => `/${tweet.author.username}/status/${tweet.id}`;
