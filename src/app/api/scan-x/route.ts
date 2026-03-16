// src/app/api/scan-x/route.ts
import { NextResponse } from 'next/server';
import axios from 'axios';
import { TwitterApi } from 'twitter-api-v2';

const X_BEARER = process.env.X_BEARER_TOKEN!;
const X_API_KEY = process.env.X_API_KEY!;
const X_API_SECRET = process.env.X_API_SECRET!;
const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN!;
const X_ACCESS_SECRET = process.env.X_ACCESS_SECRET!;
const GROK_API_KEY = process.env.GROK_API_KEY!;

let lastSinceId = '0'; // In production: use Vercel KV, Redis, or a database to persist this

const client = new TwitterApi({
  appKey: X_API_KEY,
  appSecret: X_API_SECRET,
  accessToken: X_ACCESS_TOKEN,
  accessSecret: X_ACCESS_SECRET,
});

export async function GET() {
  // Debug line – remove or comment out after testing
  console.log("API route /scan-x invoked", {
    bearerPresent: !!X_BEARER,
    grokPresent: !!GROK_API_KEY,
    accessTokenPresent: !!X_ACCESS_TOKEN,
    timestamp: new Date().toISOString(),
  });

  // Optional early debug response (uncomment if you want to test route without full logic)
  // return NextResponse.json({ debug: "Route called - check Vercel Functions logs" });

  try {
    // 1. Scan recent breaking tweets
    const searchRes = await axios.get(
      `https://api.x.com/2/tweets/search/recent?query=breaking OR urgent OR developing lang:en -is:retweet min_faves:20&tweet.fields=created_at,author_id&max_results=10&since_id=${lastSinceId}`,
      { headers: { Authorization: `Bearer ${X_BEARER}` } }
    );

    const tweets = searchRes.data.data || [];
    if (tweets.length === 0) {
      return NextResponse.json({ newStories: [], message: "No new tweets found" });
    }

    // Update lastSinceId for next poll (keep the highest ID)
    lastSinceId = tweets[0].id;

    // 2. Process each tweet with Grok
    const newStories = await Promise.all(
      tweets.slice(0, 3).map(async (tweet: any) => { // limit to 3 to save credits
        try {
          const grokRes = await axios.post(
            'https://api.x.ai/v1/chat/completions',
            {
              model: 'grok-beta', // ← Updated: use current valid model name (check x.ai docs if needed)
              messages: [
                {
                  role: 'user',
                  content: `Neutralize bias, fact-check lightly, categorize (POLITICS/WAR/SPORTS/GLOBAL), summarize in 1 neutral tweet (under 280 chars), add veraScore (0-100): ${tweet.text.slice(0, 500)}`,
                },
              ],
            },
            { headers: { Authorization: `Bearer ${GROK_API_KEY}` } }
          );

          const output = grokRes.data.choices?.[0]?.message?.content || '';
          const parsed = parseGrokOutput(output);

          // 3. Auto-post to @veranewsco
          const tweetText = `${parsed.summary} 🚨 #VeraNews Neutralized from X sources.`;
          console.log("Attempting to post:", tweetText);
          const postRes = await client.v2.tweet(tweetText);
          console.log("Posted successfully:", postRes.data);

          return {
            title: parsed.title || tweet.text.slice(0, 60) + '...',
            summary: parsed.summary,
            veraScore: parsed.score || '90',
            tweetId: postRes.data.id,
          };
        } catch (innerErr: any) {
          console.error("Error processing tweet", tweet.id, innerErr.message);
          return { error: innerErr.message };
        }
      })
    );

    return NextResponse.json({ newStories });
  } catch (error: any) {
    console.error("Scan-X route error:", error.message, error.response?.data);
    return NextResponse.json(
      { error: error.message, details: error.response?.data },
      { status: error.response?.status || 500 }
    );
  }
}

function parseGrokOutput(text: string) {
  // Very basic parser – improve with better regex or structured output prompt
  return {
    title: text.match(/Title:\s*(.*)/i)?.[1]?.trim() || '',
    summary: text.match(/Summary:\s*(.*)/i)?.[1]?.trim() || text.trim(),
    score: text.match(/veraScore:\s*(\d+)/i)?.[1] || '90',
  };
}
