const MAX_IMAGE_CHARS = 2_500_000;
const VALID_SPACES = new Set(["Pantry", "Fridge", "Freezer", "Garage", "Bathroom", "Storage"]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function outputText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output || []) {
    if (item?.type !== "message") continue;
    for (const part of item?.content || []) {
      if (part?.type === "output_text" && typeof part?.text === "string") return part.text;
    }
  }
  return "";
}

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Netlify.env.get("OPENAI_API_KEY");
  if (!apiKey) return json({ error: "AI scanning is not connected yet. Add OPENAI_API_KEY in Netlify environment variables." }, 503);

  try {
    const body = await req.json();
    const image = typeof body?.image === "string" ? body.image : "";
    const space = VALID_SPACES.has(body?.space) ? body.space : "Storage";

    if (!image.startsWith("data:image/")) return json({ error: "Please take or choose a photo first." }, 400);
    if (image.length > MAX_IMAGE_CHARS) return json({ error: "That photo is too large. Retake it a little closer." }, 413);

    const model = Netlify.env.get("OPENAI_VISION_MODEL") || "gpt-5.6-luna";
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        items: {
          type: "array",
          maxItems: 40,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              category: { type: "string" },
              quantity_estimate: { type: "integer", minimum: 1, maximum: 99 },
              stock_state: { type: "string", enum: ["low", "plenty"] },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              evidence: { type: "string" },
            },
            required: ["name", "category", "quantity_estimate", "stock_state", "confidence", "evidence"],
          },
        },
      },
      required: ["items"],
    };

    const prompt = `You are the visual inventory engine for Got It?. Analyze this ${space} photo conservatively.\n\nRULES:\n- Return ONLY items you can actually see in this exact photo. Never infer items that are typical for a ${space}.\n- Do not claim contents hidden inside opaque containers, drawers, bags, cartons, or closed packages. Example: a closed egg carton may be named "egg carton", but do not estimate eggs inside it.\n- Prefer recognizable product/type names such as "Heinz ketchup", "milk", "Diet Coke cans", or "AA batteries". Do not invent a brand you cannot read.\n- quantity_estimate means visible packages/units, not unseen contents. If exact counting is impossible, give the most conservative visible estimate.\n- high confidence = clearly visible and identifiable. medium = likely but partially obscured. low = ambiguous.\n- stock_state is a coarse visual estimate only: low when visibly near-empty/small remaining quantity, otherwise plenty.\n- evidence must briefly say what visual evidence supports the detection.\n- If nothing is clearly identifiable, return an empty items array.`;

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: "low" },
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: image, detail: "high" },
          ],
        }],
        text: {
          format: {
            type: "json_schema",
            name: "household_inventory_scan",
            strict: true,
            schema,
          },
        },
      }),
    });

    const payload = await upstream.json();
    if (!upstream.ok) {
      console.error("OpenAI scan error", upstream.status, payload?.error?.message || payload);
      return json({ error: "The AI scan service couldn’t analyze that photo. Try again." }, 502);
    }

    const text = outputText(payload);
    if (!text) return json({ error: "The AI scan returned no usable result. Try a clearer photo." }, 502);
    const parsed = JSON.parse(text);
    return json({ items: parsed.items || [] });
  } catch (error) {
    console.error("Analyze space failed", error);
    return json({ error: "Something went wrong analyzing this photo. Nothing was saved." }, 500);
  }
};

export const config = { path: "/api/analyze-space" };
