import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const downloadFoldersEnv = Deno.env.get("DOWNLOAD_FOLDERS") || "";
    const allowedExtensionsEnv = Deno.env.get("ALLOWED_EXTENSIONS") || "";

    const folders: string[] = [];
    if (downloadFoldersEnv) {
      const pairs = downloadFoldersEnv.split(";");
      for (const pair of pairs) {
        const [key] = pair.split(":");
        if (key) {
          folders.push(key.trim());
        }
      }
    }

    const allowedExtensions = allowedExtensionsEnv
      .split(",")
      .map(ext => ext.trim())
      .filter(ext => ext.length > 0);

    return new Response(
      JSON.stringify({
        folders,
        allowedExtensions,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
