/**
 * Starts the processor through GitHub's repository_dispatch.
 * Failure is logged but not fatal: the nightly run picks the upload up.
 */
export function createDispatcher(config) {
  return {
    async uploadReady(uploadId) {
      const { token, repo } = config.github;
      if (!token || !repo) {
        console.log(`dispatch skipped for upload ${uploadId} (GitHub not configured)`);
        return false;
      }
      try {
        const response = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'audify-backend',
          },
          body: JSON.stringify({
            event_type: 'upload-ready',
            client_payload: { upload_id: uploadId },
          }),
        });
        if (!response.ok) console.error(`dispatch failed for upload ${uploadId}: ${response.status}`);
        return response.ok;
      } catch (error) {
        console.error(`dispatch failed for upload ${uploadId}: ${error.message}`);
        return false;
      }
    },
  };
}
