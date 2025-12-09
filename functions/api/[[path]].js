// Cloudflare Workers API for Gallery
// Handles image uploads, retrieval, and deletion using R2 and KV

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/', '');

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle OPTIONS requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Get bindings - using your specific binding names
      const r2Bucket = env['gallery-imagessda'];
      const kvStore = env.GALLERY_SSDA;

      if (!r2Bucket || !kvStore) {
        return new Response(
          JSON.stringify({ 
            error: 'R2 or KV bindings not configured',
            details: `R2 binding 'gallery-imagessda' and KV binding 'GALLERY_SSDA' must be configured in Cloudflare Pages settings`
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Route handlers
      if (path === 'upload' && request.method === 'POST') {
        return handleUpload(request, r2Bucket, kvStore, corsHeaders);
      } else if (path === 'gallery' && request.method === 'GET') {
        return handleGetGallery(kvStore, r2Bucket, corsHeaders);
      } else if (path === 'groups' && request.method === 'GET') {
        return handleGetGroups(kvStore, corsHeaders);
      } else if (path.startsWith('delete/') && request.method === 'DELETE') {
        const imageId = path.replace('delete/', '');
        return handleDeleteImage(imageId, r2Bucket, kvStore, corsHeaders);
      } else if (path.startsWith('delete-group/') && request.method === 'DELETE') {
        const groupName = decodeURIComponent(path.replace('delete-group/', ''));
        return handleDeleteGroup(groupName, r2Bucket, kvStore, corsHeaders);
      } else if (path.startsWith('image/')) {
        const imageId = path.replace('image/', '');
        return handleGetImage(imageId, r2Bucket, corsHeaders);
      } else {
        return new Response(
          JSON.stringify({ error: 'Not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch (error) {
      console.error('API Error:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  },
};

// Upload handler
async function handleUpload(request, r2Bucket, kvStore, corsHeaders) {
  try {
    const formData = await request.formData();
    const group = formData.get('group') || 'Ungrouped';
    const images = formData.getAll('images');

    if (images.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No images provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const uploadedImages = [];

    for (const imageFile of images) {
      if (!imageFile || !(imageFile instanceof File)) continue;

      // Generate unique ID
      const imageId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      const fileExtension = imageFile.name.split('.').pop() || 'jpg';
      const fileName = `${imageId}.${fileExtension}`;
      const r2Key = fileName;

      // Convert File to ArrayBuffer (R2 requires ArrayBuffer/Blob/Stream)
      const fileBody = await imageFile.arrayBuffer();

      // Determine Content-Type
      const contentType = imageFile.type || getContentTypeFromExtension(fileExtension);

      // Upload to R2
      await r2Bucket.put(r2Key, fileBody, {
        httpMetadata: {
          contentType: contentType,
          cacheControl: 'public, max-age=31536000',
        },
      });

      // Verify upload exists and has size > 0
      const verify = await r2Bucket.get(r2Key);
      if (!verify || verify.size === 0) {
        throw new Error(`Upload verification failed for ${fileName}`);
      }

      // Get public URL
      const imageUrl = `/api/image/${fileName}`;

      // Store metadata in KV
      const metadata = {
        id: imageId,
        fileName: fileName,
        url: imageUrl,
        group: group,
        uploadedAt: new Date().toISOString(),
        size: imageFile.size,
        type: contentType,
      };

      await kvStore.put(`image:${imageId}`, JSON.stringify(metadata));

      // Add to group list
      const groupKey = `group:${group}`;
      const existingGroup = await kvStore.get(groupKey);
      const groupImages = existingGroup ? JSON.parse(existingGroup) : [];
      groupImages.push(imageId);
      await kvStore.put(groupKey, JSON.stringify(groupImages));

      uploadedImages.push(metadata);
    }

    // Update gallery index
    const galleryIndex = await kvStore.get('gallery:index');
    const index = galleryIndex ? JSON.parse(galleryIndex) : [];
    uploadedImages.forEach(img => {
      if (!index.includes(img.id)) {
        index.push(img.id);
      }
    });
    await kvStore.put('gallery:index', JSON.stringify(index));

    return new Response(
      JSON.stringify({ success: true, images: uploadedImages }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Upload error:', error);
    return new Response(
      JSON.stringify({ error: 'Upload failed: ' + error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

// Helper function to determine Content-Type from file extension
function getContentTypeFromExtension(ext) {
  const contentTypes = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'bmp': 'image/bmp',
  };
  return contentTypes[ext.toLowerCase()] || 'image/jpeg';
}

// Get gallery handler
async function handleGetGallery(kvStore, r2Bucket, corsHeaders) {
  try {
    const galleryIndex = await kvStore.get('gallery:index');
    const index = galleryIndex ? JSON.parse(galleryIndex) : [];

    const images = [];

    for (const imageId of index) {
      const metadataStr = await kvStore.get(`image:${imageId}`);
      if (metadataStr) {
        const metadata = JSON.parse(metadataStr);
        // Update URL to use the image endpoint
        metadata.url = `/api/image/${metadata.fileName}`;
        images.push(metadata);
      }
    }

    // Sort by upload date (newest first)
    images.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    return new Response(
      JSON.stringify({ images }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Get gallery error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to load gallery' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

// Get groups handler
async function handleGetGroups(kvStore, corsHeaders) {
  try {
    const list = await kvStore.list({ prefix: 'group:' });
    const groups = [];

    for (const key of list.keys) {
      const groupName = key.name.replace('group:', '');
      if (groupName && groupName !== 'Ungrouped') {
        groups.push(groupName);
      }
    }

    // Add Ungrouped if it exists
    const ungrouped = await kvStore.get('group:Ungrouped');
    if (ungrouped) {
      groups.push('Ungrouped');
    }

    return new Response(
      JSON.stringify(groups.sort()),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Get groups error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to load groups' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

// Delete image handler
async function handleDeleteImage(imageId, r2Bucket, kvStore, corsHeaders) {
  try {
    // Get metadata
    const metadataStr = await kvStore.get(`image:${imageId}`);
    if (!metadataStr) {
      return new Response(
        JSON.stringify({ error: 'Image not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const metadata = JSON.parse(metadataStr);

    // Delete from R2
    await r2Bucket.delete(metadata.fileName);

    // Delete from KV
    await kvStore.delete(`image:${imageId}`);

    // Remove from group
    const groupKey = `group:${metadata.group}`;
    const groupData = await kvStore.get(groupKey);
    if (groupData) {
      const groupImages = JSON.parse(groupData);
      const updatedGroup = groupImages.filter(id => id !== imageId);
      if (updatedGroup.length > 0) {
        await kvStore.put(groupKey, JSON.stringify(updatedGroup));
      } else {
        await kvStore.delete(groupKey);
      }
    }

    // Remove from index
    const galleryIndex = await kvStore.get('gallery:index');
    if (galleryIndex) {
      const index = JSON.parse(galleryIndex);
      const updatedIndex = index.filter(id => id !== imageId);
      await kvStore.put('gallery:index', JSON.stringify(updatedIndex));
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Delete error:', error);
    return new Response(
      JSON.stringify({ error: 'Delete failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

// Delete group handler
async function handleDeleteGroup(groupName, r2Bucket, kvStore, corsHeaders) {
  try {
    const groupKey = `group:${groupName}`;
    const groupData = await kvStore.get(groupKey);

    if (!groupData) {
      return new Response(
        JSON.stringify({ error: 'Group not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const groupImages = JSON.parse(groupData);

    // Delete all images in the group
    for (const imageId of groupImages) {
      const metadataStr = await kvStore.get(`image:${imageId}`);
      if (metadataStr) {
        const metadata = JSON.parse(metadataStr);
        await r2Bucket.delete(metadata.fileName);
        await kvStore.delete(`image:${imageId}`);
      }
    }

    // Delete group
    await kvStore.delete(groupKey);

    // Update index
    const galleryIndex = await kvStore.get('gallery:index');
    if (galleryIndex) {
      const index = JSON.parse(galleryIndex);
      const updatedIndex = index.filter(id => !groupImages.includes(id));
      await kvStore.put('gallery:index', JSON.stringify(updatedIndex));
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Delete group error:', error);
    return new Response(
      JSON.stringify({ error: 'Delete group failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

// Get image handler (serves image from R2)
async function handleGetImage(imageId, r2Bucket, corsHeaders) {
  try {
    // Parse filename from URL (handle URL encoding)
    const r2Key = decodeURIComponent(imageId);

    // Get from R2
    const object = await r2Bucket.get(r2Key);

    if (!object) {
      return new Response('Image not found', { status: 404, headers: corsHeaders });
    }

    // Determine Content-Type (from metadata or file extension)
    let contentType = 'image/jpeg'; // default
    if (object.httpMetadata && object.httpMetadata.contentType) {
      contentType = object.httpMetadata.contentType;
    } else {
      // Fallback to extension-based detection
      const ext = r2Key.split('.').pop()?.toLowerCase();
      contentType = getContentTypeFromExtension(ext || 'jpg');
    }

    // Set headers
    const headers = new Headers(corsHeaders);
    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'public, max-age=3600');
    
    // Set Content-Length if available
    if (object.size) {
      headers.set('Content-Length', object.size.toString());
    }
    
    // Set ETag if available
    if (object.httpEtag) {
      headers.set('ETag', object.httpEtag);
    }

    // Stream response
    return new Response(object.body, { headers });
  } catch (error) {
    console.error('Get image error:', error);
    return new Response('Error loading image', { status: 500, headers: corsHeaders });
  }
}

