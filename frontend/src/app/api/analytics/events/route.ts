import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const MAX_BATCH_SIZE = 100;
const MAX_EVENTS_IN_MEMORY = 1000;

const eventBuffer: Array<{ event: string; timestamp: number; [key: string]: unknown }> = [];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const events = body?.events;

    if (!Array.isArray(events)) {
      return NextResponse.json({ error: "events must be an array" }, { status: 400 });
    }

    if (events.length > MAX_BATCH_SIZE) {
      return NextResponse.json(
        { error: `Batch size exceeds limit of ${MAX_BATCH_SIZE}` },
        { status: 400 }
      );
    }

    // Ring buffer: drop oldest when full
    for (const event of events) {
      eventBuffer.push(event);
      if (eventBuffer.length > MAX_EVENTS_IN_MEMORY) {
        eventBuffer.shift();
      }
    }

    return NextResponse.json({ received: events.length }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({
    buffered: eventBuffer.length,
    events: eventBuffer.slice(-50),
  });
}
