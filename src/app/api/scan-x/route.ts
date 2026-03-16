// app/api/scan-x/route.ts
import { NextResponse } from 'next/server';
import axios from 'axios';
import { TwitterApi } from 'twitter-api-v2'; // npm install twitter-api-v2

const X_BEARER = process.env.X_BEARER_TOKEN!;
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN!;
const ACCESS_SECRET = process.env.X_ACCESS_SECRET!;
const GROK_API_KEY = process.env.GROK_API_KEY!;

let lastSinceId = '0'; // persist this in production (e.g. Vercel KV or file)

const client = new TwitterApi({
  appKey: process.env.X_API_KEY!,
  appSecret: process.env.X_API_SECRET!,
  accessToken: ACCESS_TOKEN,
  accessSecret: ACCESS_SECRET,
});

export async function GET() {
  try {
    // 1. Scan recent breaking tweets
    const searchRes = await axios.get(
      `https://api.x.com/2/tweets/search/recent?query=breaking OR urgent OR developing lang:en -is:retweet min_faves:20&tweet.fields=created_at,author_id&max_results=10&since_id=${lastSinceId}`,
      { headers: { Authorization: `Bearer ${X_BEARER}` } }
    );

    const tweets = searchRes.data.data || [];
    if (tweets.length === 0) return NextResponse.json({ newStories: [] });

    lastSinceId = tweets[0].id; // update for next poll

    // 2. Process each with Grok (neutralize + categorize + summarize)
    const newStories = await Promise.all(
      tweets.slice(0, 3).map(async (tweet: any) => { // limit to avoid credit burn
        const grokRes = await axios.post(
          'https://api.x.ai/v1/chat/completions',
          {
            model: 'grok-4',
            messages: [
              {
                role: 'user',
                content: `Neutralize bias, fact-check lightly, categorize (POLITICS/WAR/SPORTS/GLOBAL), summarize in 1 neutral tweet (under 280 chars), add veraScore (0-100): ${tweet.text}`,
              },
            ],
          },
          { headers: { Authorization: `Bearer ${GROK_API_KEY}` } }
        );

        const output = grokRes.data.choices[0].message.content;
        const parsed = parseGrokOutput(output); // implement simple parser below

        // 3. Auto-post to @veranewsco
        await client.v2.tweet(`${parsed.summary} 🚨 #VeraNews Neutralized from X sources.`);

        return {
          title: parsed.title || tweet.text.slice(0, 60) + '...',
          summary: parsed.summary,
          veraScore: parsed.score || '92',
        };
      })
    );

    return NextResponse.json({ newStories });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function parseGrokOutput(text: string) {
  // Simple regex/parser - improve as needed
  return {
    title: text.match(/Title: (.*)/)?.[1] || '',
    summary: text.match(/Summary: (.*)/)?.[1] || text,
    score: text.match(/Score: (\d+)/)?.[1] || '90',
  };
}