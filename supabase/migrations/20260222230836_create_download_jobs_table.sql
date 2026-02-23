/*
  # Create download_jobs table

  1. New Tables
    - `download_jobs`
      - `id` (uuid, primary key) - Unique job identifier
      - `url` (text) - Source URL to download from
      - `folder_key` (text) - Destination folder key (e.g., 'images', 'videos')
      - `filename` (text) - Final sanitized filename
      - `status` (text) - Job status: 'queued', 'downloading', 'done', 'error'
      - `message` (text, nullable) - Optional status message or error details
      - `created_at` (timestamptz) - Job creation timestamp
      - `updated_at` (timestamptz) - Last update timestamp

  2. Security
    - Enable RLS on `download_jobs` table
    - Add policy for public access (no auth required for this internal tool)
    
  3. Notes
    - This table tracks all download jobs and their status
    - Status can be polled via the API to show progress to users
*/

CREATE TABLE IF NOT EXISTS download_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  folder_key text NOT NULL,
  filename text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE download_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to download jobs"
  ON download_jobs
  FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow public insert access to download jobs"
  ON download_jobs
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow public update access to download jobs"
  ON download_jobs
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);