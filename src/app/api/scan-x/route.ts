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

let lastSinceId: string | null = null;

const client = new TwitterApi({
  appKey: X_API_KEY,
  appSecret: X_API_SECRET,
  accessToken: X_ACCESS_TOKEN,
  accessSecret: X_ACCESS_SECRET,
});

export async function GET() {
  console.log("API route /scan-x invoked", {
    lastSinceId,
    timestamp: new Date().toISOString(),
  });

  try {
    // Query focused on your categories; include media expansions
    let queryUrl = `https://api.x.com/2/tweets/search/recent?query=(politics OR trump OR biden OR congress OR war OR ukraine OR gaza OR israel OR iran OR disaster OR flood OR earthquake OR hurricane OR wildfire OR shooting OR terrorism OR mass shooting OR attack OR crime OR viral) lang:en -is:retweet&tweet.fields=created_at,author_id,attachments&expansions=attachments.media_keys&media.fields=url,preview_image_url,type,width,height&max_results=10`;
    if (lastSinceId) queryUrl += `&since_id=${lastSinceId}`;

    const searchRes = await axios.get(queryUrl, { headers: { Authorization: `Bearer ${X_BEARER}` } });

    const tweets = searchRes.data.data || [];
    if (tweets.length === 0) return NextResponse.json({ newStories: [], message: "No new tweets" });

    lastSinceId = tweets[0].id;

    const newStories = await Promise.all(
      tweets.slice(0, 5).map(async (tweet: any) => {
        const tweetText = tweet.text || '';
        const media = tweet.attachments?.media_keys ? searchRes.data.includes?.media || [] : [];

        // Build media URLs string (first photo/video)
        let mediaUrls = '';
        if (media.length > 0) {
          const firstMedia = media.find((m: any) => m.media_key === tweet.attachments.media_keys[0]);
          if (firstMedia?.url) {
            mediaUrls = `\n${firstMedia.type === 'video' ? 'Video' : 'Photo'}: ${firstMedia.url}`;
          }
        }

        try {
          const grokRes = await axios.post(
            'https://api.x.ai/v1/chat/completions',
            {
              model: 'grok-beta',
              messages: [
                {
                  role: 'user',
                  content: `You are a hyper-selective breaking news account like BNO News, Breaking911, OSINTdefender — first to report real events.

Only process if this is:
- High-impact POLITICS (US/major international)
- High-profile US CRIME (terrorism, mass shooting, viral incident)
- NATURAL DISASTER (flood, earthquake, hurricane, wildfire)
- WAR (Ukraine, Gaza, Israel-Iran, etc.)

Must have multiple sources/confirmation potential and be urgent/breaking. Be extremely concise (1 short sentence, 100–150 chars max).

If NOT clearly matching and high-priority → respond exactly "SKIP"

Otherwise exact format:
CATEGORY: POLITICS / US_CRIME / NATURAL_DISASTER / WAR
SUMMARY: [short urgent neutral sentence]
VERASCORE: [90-99]

Tweet text: ${tweetText.slice(0, 500)}`,
                },
              ],
            },
            { headers: { Authorization: `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' } }
          );

          const output = grokRes.data.choices?.[0]?.message?.content || '';
          console.log("Grok output:", output);

          if (output.trim().toUpperCase().startsWith("SKIP")) {
            console.log("Skipped by Grok");
            return { skipped: true };
          }

          const parsed = parseGrokOutput(output);

          const allowed = ['POLITICS', 'US_CRIME', 'NATURAL_DISASTER', 'WAR'];
          if (!allowed.includes(parsed.category)) return { skipped: true };

          const finalTweet = `${parsed.summary.trim()}${mediaUrls} #VeraNews`;

          console.log("Posting:", finalTweet);

          const postRes = await client.v2.tweet(finalTweet);

          console.log("Posted ID:", postRes.data.id);

          return {
            title: parsed.summary.slice(0, 60) + '...',
            summary: finalTweet,
            category: parsed.category,
            veraScore: parsed.score,
            tweetId: postRes.data.id,
            mediaUrl: mediaUrls ? media[0]?.url : null,
          };
        } catch (innerErr: any) {
          console.error("Tweet processing error:", {
            tweetId: tweet.id,
            message: innerErr.message,
            status: innerErr.response?.status,
            data: innerErr.response?.data,
          });
          return { error: innerErr.message };
        }
      })
    );

    return NextResponse.json({ newStories, lastSinceId });
  } catch (error: any) {
    console.error("Route error:", error.message, error.response?.data);
    return NextResponse.json({ error: error.message, details: error.response?.data }, { status: 500 });
  }
}

function parseGrokOutput(text: string) {
  return {
    category: text.match(/CATEGORY:\s*(POLITICS|US_CRIME|NATURAL_DISASTER|WAR)/i)?.[1]?.toUpperCase() || 'SKIP',
    summary: text.match(/SUMMARY:\s*(.*)/i)?.[1]?.trim() || '',
    score: text.match(/VERASCORE:\s*(\d+)/i)?.[1] || '90',
  };
}
