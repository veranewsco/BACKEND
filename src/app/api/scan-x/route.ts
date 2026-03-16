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

let lastSinceId: string | null = null; // Start with null to fetch recent tweets first

const client = new TwitterApi({
  appKey: X_API_KEY,
  appSecret: X_API_SECRET,
  accessToken: X_ACCESS_TOKEN,
  accessSecret: X_ACCESS_SECRET,
});

export async function GET() {
  console.log("API route /scan-x invoked", {
    bearerPresent: !!X_BEARER,
    grokPresent: !!GROK_API_KEY,
    accessTokenPresent: !!X_ACCESS_TOKEN,
    lastSinceId,
    timestamp: new Date().toISOString(),
  });

  try {
    // 1. Build query – omit since_id if null to get latest tweets
    let queryUrl = `https://api.x.com/2/tweets/search/recent?query=breaking OR urgent OR developing lang:en -is:retweet min_faves:20&tweet.fields=created_at,author_id&max_results=10`;
    if (lastSinceId) {
      queryUrl += `&since_id=${lastSinceId}`;
    }

    const searchRes = await axios.get(queryUrl, {
      headers: { Authorization: `Bearer ${X_BEARER}` },
    });

    const tweets = searchRes.data.data || [];
    if (tweets.length === 0) {
      return NextResponse.json({ newStories: [], message: "No new tweets found" });
    }

    // Update lastSinceId to the newest tweet ID (first in results, assuming chronological)
    lastSinceId = tweets[0].id;

    // 2. Process recent tweets with Grok
    const newStories = await Promise.all(
      tweets.slice(0, 3).map(async (tweet: any) => {
        try {
          const grokRes = await axios.post(
            'https://api.x.ai/v1/chat/completions',
            {
              model: 'grok-beta', // Use current stable model (confirm in x.ai docs if needed)
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

          // 3. Auto-post to @VeraNewsCo
          const tweetText = `${parsed.summary} 🚨 #VeraNews Neutralized from X sources.`;
          console.log("Posting tweet:", tweetText);
          const postRes = await client.v2.tweet(tweetText);
          console.log("Posted:", postRes.data);

          return {
            title: parsed.title || tweet.text.slice(0, 60) + '...',
            summary: parsed.summary,
            veraScore: parsed.score || '90',
            tweetId: postRes.data.id,
          };
        } catch (innerErr: any) {
          console.error("Error processing tweet", tweet.id, innerErr.message, innerErr.response?.data);
          return { error: innerErr.message };
        }
      })
    );

    return NextResponse.json({ newStories, lastSinceId });
  } catch (error: any) {
    console.error("Scan-X error:", error.message, error.response?.data || error);
    // If since_id invalid, reset for next try
    if (error.response?.data?.errors?.[0]?.message?.includes('since_id')) {
      lastSinceId = null;
      console.log("Invalid since_id detected – resetting for next poll");
    }
    return NextResponse.json(
      { error: error.message, details: error.response?.data },
      { status: error.response?.status || 500 }
    );
  }
}

function parseGrokOutput(text: string) {
  return {
    title: text.match(/Title:\s*(.*)/i)?.[1]?.trim() || '',
    summary: text.match(/Summary:\s*(.*)/i)?.[1]?.trim() || text.trim(),
    score: text.match(/veraScore:\s*(\d+)/i)?.[1] || '90',
  };
}
