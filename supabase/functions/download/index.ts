import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface DownloadRequest {
  url: string;
  folderKey: string;
  filenameOverride?: string;
}

function parseFolderMapping(downloadFoldersEnv: string): Map<string, string> {
  const mapping = new Map<string, string>();
  if (!downloadFoldersEnv) return mapping;

  const pairs = downloadFoldersEnv.split(";");
  for (const pair of pairs) {
    const [key, path] = pair.split(":");
    if (key && path) {
      mapping.set(key.trim(), path.trim());
    }
  }
  return mapping;
}

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/\.\./g, "")
    .replace(/[\/\\]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .substring(0, 255);
}

function isInternalIP(hostname: string): boolean {
  if (hostname === "localhost") return true;

  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = hostname.match(ipv4Regex);

  if (!match) return false;

  const parts = match.slice(1, 5).map(Number);

  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;

  return false;
}

async function downloadFile(
  url: string,
  destPath: string
): Promise<{ success: boolean; message?: string }> {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
    });

    if (!response.ok) {
      return {
        success: false,
        message: `HTTP error: ${response.status} ${response.statusText}`,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    await Deno.writeFile(destPath, data);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Download failed",
    };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: DownloadRequest = await req.json();
    const { url, folderKey, filenameOverride } = body;

    if (!url || !folderKey) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: url and folderKey" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid URL format" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return new Response(
        JSON.stringify({ error: "Only HTTP and HTTPS protocols are allowed" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (isInternalIP(parsedUrl.hostname)) {
      return new Response(
        JSON.stringify({ error: "Internal/private IP addresses are not allowed" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const downloadFoldersEnv = Deno.env.get("DOWNLOAD_FOLDERS") || "";
    const folderMapping = parseFolderMapping(downloadFoldersEnv);

    if (!folderMapping.has(folderKey)) {
      return new Response(
        JSON.stringify({ error: `Invalid folder key: ${folderKey}` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const destinationFolder = folderMapping.get(folderKey)!;

    let filename: string;
    if (filenameOverride) {
      filename = sanitizeFilename(filenameOverride);
    } else {
      const urlPath = parsedUrl.pathname;
      const lastSegment = urlPath.substring(urlPath.lastIndexOf("/") + 1);
      filename = sanitizeFilename(lastSegment || "download");
    }

    if (!filename || filename === "") {
      filename = "download";
    }

    const allowedExtensionsEnv = Deno.env.get("ALLOWED_EXTENSIONS") || "";
    const allowedExtensions = allowedExtensionsEnv
      .split(",")
      .map((ext) => ext.trim().toLowerCase())
      .filter((ext) => ext.length > 0);

    if (allowedExtensions.length > 0) {
      const fileExt = filename.substring(filename.lastIndexOf(".")).toLowerCase();
      if (!allowedExtensions.includes(fileExt)) {
        return new Response(
          JSON.stringify({
            error: `File extension ${fileExt} is not allowed. Allowed: ${allowedExtensions.join(", ")}`,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    const fullPath = `${destinationFolder}/${filename}`;

    if (!fullPath.startsWith(destinationFolder + "/")) {
      return new Response(
        JSON.stringify({ error: "Path traversal detected" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: jobData, error: insertError } = await supabase
      .from("download_jobs")
      .insert({
        url,
        folder_key: folderKey,
        filename,
        status: "queued",
      })
      .select()
      .maybeSingle();

    if (insertError || !jobData) {
      return new Response(
        JSON.stringify({ error: "Failed to create download job" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const jobId = jobData.id;

    EdgeRuntime.waitUntil(
      (async () => {
        await supabase
          .from("download_jobs")
          .update({ status: "downloading", updated_at: new Date().toISOString() })
          .eq("id", jobId);

        const result = await downloadFile(url, fullPath);

        if (result.success) {
          await supabase
            .from("download_jobs")
            .update({
              status: "done",
              message: `Downloaded to ${fullPath}`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", jobId);
        } else {
          await supabase
            .from("download_jobs")
            .update({
              status: "error",
              message: result.message,
              updated_at: new Date().toISOString(),
            })
            .eq("id", jobId);
        }
      })()
    );

    return new Response(
      JSON.stringify({
        id: jobId,
        status: "queued",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
