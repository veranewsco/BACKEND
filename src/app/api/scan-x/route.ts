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

// Start with null so first call fetches latest tweets without since_id
let lastSinceId: string | null = null;

const client = new TwitterApi({
  appKey: X_API_KEY,
  appSecret: X_API_SECRET,
  accessToken: X_ACCESS_TOKEN,
  accessSecret: X_ACCESS_SECRET,
});

export async function GET() {
  // Debug log with explicit properties (avoids shorthand issues)
  console.log("API route /scan-x invoked", {
    bearerPresent: !!X_BEARER,
    grokPresent: !!GROK_API_KEY,
    accessTokenPresent: !!X_ACCESS_TOKEN,
    lastSinceIdValue: lastSinceId,
    timestamp: new Date().toISOString(),
  });

  try {
    // Build query URL
    let queryUrl = `https://api.x.com/2/tweets/search/recent?query=breaking OR urgent OR developing lang:en -is:retweet&tweet.fields=created_at,author_id&max_results=10`;
    if (lastSinceId !== null) {
      queryUrl += `&since_id=${lastSinceId}`;
    }

    const searchRes = await axios.get(queryUrl, {
      headers: { Authorization: `Bearer ${X_BEARER}` },
    });

    const tweets = searchRes.data.data || [];
    if (tweets.length === 0) {
      return NextResponse.json({ newStories: [], message: "No new tweets found" });
    }

    // Update to the newest tweet ID
    lastSinceId = tweets[0].id;

    console.log(`Found ${tweets.length} tweets, updated lastSinceId to ${lastSinceId}`);

    // Process up to 3 tweets
    const newStories = await Promise.all(
      tweets.slice(0, 3).map(async (tweet: any) => {
        const tweetText = tweet.text || '(no text)';
        console.log(`Processing tweet ${tweet.id}: ${tweetText.slice(0, 100)}...`);

        try {
          // Grok call
          const grokPayload = {
            model: 'grok-4',  // Change to 'grok-1' or check https://api.x.ai/docs if 400 persists
            messages: [
              {
                role: 'user',
                content: `Neutralize bias, categorize (POLITICS/WAR/SPORTS/GLOBAL), summarize in 1 short neutral tweet (under 280 chars), add veraScore (0-100): ${tweetText.slice(0, 400)}`,
              },
            ],
          };

          console.log("Grok payload:", grokPayload);

          const grokRes = await axios.post(
            'https://api.x.ai/v1/chat/completions',
            grokPayload,
            {
              headers: {
                Authorization: `Bearer ${GROK_API_KEY}`,
                'Content-Type': 'application/json',
              },
            }
          );

          const output = grokRes.data.choices?.[0]?.message?.content || 'No output from Grok';
          console.log("Grok output:", output);

          const parsed = parseGrokOutput(output);

          const finalTweet = `${parsed.summary} 🚨 #VeraNews (Score: ${parsed.score})`;
          console.log("Attempting post:", finalTweet);

          const postRes = await client.v2.tweet(finalTweet);
          console.log("Posted successfully:", postRes.data.id);

          return {
            title: parsed.title || tweetText.slice(0, 60) + '...',
            summary: parsed.summary,
            veraScore: parsed.score || '90',
            tweetId: postRes.data.id,
          };
        } catch (innerErr: any) {
          console.error("Error in tweet processing loop:", {
            tweetId: tweet.id,
            message: innerErr.message,
            status: innerErr.response?.status,
            responseData: innerErr.response?.data,
          });
          return { error: innerErr.message, details: innerErr.response?.data };
        }
      })
    );

    return NextResponse.json({ newStories, lastSinceId });
  } catch (error: any) {
    console.error("Outer route error:", error.message, error.response?.data);
    return NextResponse.json({ error: error.message, details: error.response?.data }, { status: 500 });
  }
}

function parseGrokOutput(text: string) {
  return {
    title: text.match(/Title:\s*(.*)/i)?.[1]?.trim() || '',
    summary: text.match(/Summary:\s*(.*)/i)?.[1]?.trim() || text.trim(),
    score: text.match(/veraScore:\s*(\d+)/i)?.[1] || '90',
  };
}
