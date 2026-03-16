// ... imports and constants same as before ...

export async function GET() {
  console.log("API route invoked", { lastSinceId, timestamp: new Date().toISOString() });

  try {
    let queryUrl = `https://api.x.com/2/tweets/search/recent?query=breaking OR urgent OR developing lang:en -is:retweet&tweet.fields=created_at,author_id&max_results=10`;
    if (lastSinceId) queryUrl += `&since_id=${lastSinceId}`;

    const searchRes = await axios.get(queryUrl, {
      headers: { Authorization: `Bearer ${X_BEARER}` },
    });

    const tweets = searchRes.data.data || [];
    if (tweets.length === 0) return NextResponse.json({ newStories: [], message: "No tweets" });

    lastSinceId = tweets[0].id;
    console.log(`Found ${tweets.length} tweets, new lastSinceId: ${lastSinceId}`);

    const newStories = await Promise.all(
      tweets.slice(0, 3).map(async (tweet: any) => {
        const tweetText = tweet.text || '(empty tweet)';
        console.log(`Processing tweet ${tweet.id}:`, tweetText.slice(0, 100) + '...');

        try {
          console.log("Calling Grok API...");
          const grokRes = await axios.post(
            'https://api.x.ai/v1/chat/completions',
            {
              model: 'grok-beta', // Try 'grok-1' or check https://api.x.ai/docs/models for exact name
              messages: [
                {
                  role: 'user',
                  content: `Neutralize bias, categorize (POLITICS/WAR/SPORTS/GLOBAL), summarize in 1 short neutral tweet, add veraScore (0-100): ${tweetText.slice(0, 400)}`,
                },
              ],
            },
            {
              headers: {
                Authorization: `Bearer ${GROK_API_KEY}`,
                'Content-Type': 'application/json',
              },
            }
          );

          console.log("Grok response status:", grokRes.status);
          const output = grokRes.data.choices?.[0]?.message?.content || 'No output';
          console.log("Grok output:", output);

          const parsed = parseGrokOutput(output);

          const finalTweet = `${parsed.summary} 🚨 #VeraNews (Score: ${parsed.score})`;
          console.log("Posting:", finalTweet);

          const postRes = await client.v2.tweet(finalTweet);
          console.log("Posted ID:", postRes.data.id);

          return {
            title: parsed.title || tweetText.slice(0, 60) + '...',
            summary: parsed.summary,
            veraScore: parsed.score || '90',
            tweetId: postRes.data.id,
          };
        } catch (innerErr: any) {
          console.error("Inner error for tweet", tweet.id, {
            message: innerErr.message,
            status: innerErr.response?.status,
            data: innerErr.response?.data,
            code: innerErr.code,
          });
          return { error: innerErr.message, details: innerErr.response?.data };
        }
      })
    );

    return NextResponse.json({ newStories, lastSinceId });
  } catch (error: any) {
    console.error("Outer error:", error.message, error.response?.data);
    return NextResponse.json({ error: error.message, details: error.response?.data }, { status: 500 });
  }
}

// parseGrokOutput same as before
