// Cloudflare Workers API for Gallery
// Handles image uploads, retrieval, and deletion using R2 and KV

// Helper function to detect R2 binding (handles different naming conventions)
function getR2Binding(env) {
  // Try exact match first (your specific binding name)
  if (env['gallery-imagessda']) {
    console.log('✅ Found R2 binding: gallery-imagessda');
    return env['gallery-imagessda'];
  }
  
  // Try other common variations
  if (env.GALLERY_R2) return env.GALLERY_R2;
  if (env.gallery_r2) return env.gallery_r2;
  if (env.Gallery_R2) return env.Gallery_R2;
  if (env['gallery-images']) return env['gallery-images'];
  
  // Search for any R2-related binding
  const allEnvKeys = Object.keys(env);
  const r2Keys = allEnvKeys.filter(key => {
    const lower = key.toLowerCase();
    const isR2Like = (lower.includes('r2') || lower.includes('gallery') || lower.includes('bucket'));
    const isObject = typeof env[key] === 'object' && env[key] !== null;
    const hasR2Methods = ('put' in env[key] || 'get' in env[key] || 'list' in env[key]);
    return isR2Like && isObject && hasR2Methods;
  });
  
  if (r2Keys.length > 0) {
    console.log('✅ Found R2 binding with name:', r2Keys[0]);
    return env[r2Keys[0]];
  }
  
  console.warn('⚠️ No R2 binding found. Available keys:', allEnvKeys);
  return null;
}

// Helper function to detect KV binding
function getKVBinding(env) {
  // Try exact match first (your specific binding name)
  if (env.GALLERY_SSDA) {
    console.log('✅ Found KV binding: GALLERY_SSDA');
    return env.GALLERY_SSDA;
  }
  
  // Try other common variations
  if (env.GALLERY_KV) return env.GALLERY_KV;
  if (env.gallery_kv) return env.gallery_kv;
  if (env.Gallery_KV) return env.Gallery_KV;
  
  // Search for any KV-related binding
  const allEnvKeys = Object.keys(env);
  const kvKeys = allEnvKeys.filter(key => {
    const lower = key.toLowerCase();
    return (lower.includes('kv') || lower.includes('gallery')) &&
           typeof env[key] === 'object' && 
           env[key] !== null &&
           ('get' in env[key] || 'put' in env[key]);
  });
  
  if (kvKeys.length > 0) {
    console.log('✅ Found KV binding with name:', kvKeys[0]);
    return env[kvKeys[0]];
  }
  
  return null;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

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
    // Get bindings with flexible detection
    const r2Bucket = getR2Binding(env);
    const kvStore = getKVBinding(env);

    if (!r2Bucket || !kvStore) {
      return new Response(
        JSON.stringify({ 
          error: 'R2 or KV bindings not configured',
          details: `R2 binding 'gallery-imagessda' and KV binding 'GALLERY_SSDA' must be configured in Cloudflare Pages settings`
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Route handlers (using full path like HomeMadeDelights)
    if (path === '/api/upload' && request.method === 'POST') {
      return handleUpload(request, r2Bucket, kvStore, corsHeaders);
    } else if (path === '/api/gallery' && request.method === 'GET') {
      return handleGetGallery(kvStore, r2Bucket, corsHeaders);
    } else if (path === '/api/groups' && request.method === 'GET') {
      return handleGetGroups(kvStore, corsHeaders);
    } else if (path.startsWith('/api/delete/') && request.method === 'DELETE') {
      const imageId = path.replace('/api/delete/', '');
      return handleDeleteImage(imageId, r2Bucket, kvStore, corsHeaders);
    } else if (path.startsWith('/api/delete-group/') && request.method === 'DELETE') {
      const groupName = decodeURIComponent(path.replace('/api/delete-group/', ''));
      return handleDeleteGroup(groupName, r2Bucket, kvStore, corsHeaders);
    } else if (path.startsWith('/api/image/')) {
      let filename = path.split('/api/image/')[1];
      // Handle query parameters if any
      if (filename.includes('?')) {
        filename = filename.split('?')[0];
      }
      // URL decode the filename
      try {
        filename = decodeURIComponent(filename);
      } catch (e) {
        console.warn('Failed to decode filename, using as-is:', filename, e);
      }
      return handleGetImage(filename, r2Bucket, corsHeaders);
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
}

// Upload handler
async function handleUpload(request, r2Bucket, kvStore, corsHeaders) {
  try {
    // Check bindings first
    if (!r2Bucket) {
      return new Response(JSON.stringify({ 
        error: 'R2 bucket binding not configured.',
        details: 'Please configure R2 binding in Cloudflare Pages Settings → Functions.',
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!kvStore) {
      return new Response(JSON.stringify({ 
        error: 'KV namespace binding not configured.',
        details: 'Please configure GALLERY_SSDA binding in Cloudflare Pages Settings → Functions.',
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

    for (let i = 0; i < images.length; i++) {
      const imageFile = images[i];
      if (!imageFile || !(imageFile instanceof File)) continue;

      // Generate unique ID
      const imageId = `${Date.now()}-${i}-${Math.random().toString(36).substring(2, 15)}`;
      const fileExtension = imageFile.name.split('.').pop() || 'jpg';
      const imageName = `image-${imageId}.${fileExtension}`;
      // Store in R2 with gallery-images/gallery-image/ directory structure (like HomeMadeDelights)
      const r2Key = `gallery-images/gallery-image/${imageName}`;

      // Convert File to ArrayBuffer (R2 requires ArrayBuffer/Blob/Stream)
      let fileBody;
      try {
        if (imageFile && typeof imageFile.arrayBuffer === 'function') {
          fileBody = await imageFile.arrayBuffer();
          console.log('✅ Converted to ArrayBuffer, size:', fileBody.byteLength);
        } else if (imageFile instanceof Blob) {
          fileBody = await imageFile.arrayBuffer();
        } else {
          throw new Error('File object does not have arrayBuffer() method');
        }
      } catch (conversionError) {
        console.error('File conversion error:', conversionError);
        throw new Error('Failed to convert file to uploadable format: ' + conversionError.message);
      }

      if (!fileBody) {
        throw new Error('File body is null or undefined after conversion');
      }

      // Determine Content-Type
      const contentType = imageFile.type || getContentTypeFromExtension(fileExtension);

      console.log('📤 Uploading to R2:', r2Key, 'Content-Type:', contentType, 'Size:', fileBody.byteLength);

      // Upload to R2
      await r2Bucket.put(r2Key, fileBody, {
        httpMetadata: {
          contentType: contentType,
          cacheControl: 'public, max-age=31536000',
        },
      });

      console.log('✅ R2 put completed:', r2Key);

      // Verify upload exists and has size > 0 (with delay like HomeMadeDelights)
      await new Promise(resolve => setTimeout(resolve, 200));
      const verify = await r2Bucket.get(r2Key);
      if (!verify) {
        console.error('❌ Upload verification failed - object not found:', r2Key);
        throw new Error(`Upload verification failed for ${imageName}`);
      }
      if (verify.size === 0) {
        console.error('❌ Upload verification failed - file size is 0:', r2Key);
        throw new Error(`Upload verification failed - file size is 0 for ${imageName}`);
      }
      console.log('✅ Upload verified - object exists in R2:', r2Key, 'Size:', verify.size, 'bytes');

      // Get public URL
      const imageUrl = `/api/image/${r2Key}`;

      // Store metadata in KV
      const metadata = {
        id: imageId,
        fileName: r2Key, // Store full R2 key including directory
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

    console.log('✅ Upload complete:', {
      imagesUploaded: uploadedImages.length,
      totalImages: index.length
    });

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
async function handleGetImage(filename, r2Bucket, corsHeaders) {
  try {
    if (!r2Bucket) {
      console.error('R2 binding not available for image:', filename);
      return new Response('R2 binding not configured', {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
      });
    }
    
    // The filename from URL should include gallery-images/gallery-image/ prefix
    // Handle backward compatibility with old formats (like HomeMadeDelights)
    let r2Key = filename;
    if (!filename.startsWith('gallery-images/gallery-image/')) {
      // Try different formats for backward compatibility
      if (filename.startsWith('gallery-images/')) {
        r2Key = filename.replace(/^gallery-images\//, 'gallery-images/gallery-image/');
        console.log('🔍 Updating path to full structure:', r2Key);
      } else if (filename.startsWith('gallery-image/')) {
        r2Key = filename.replace(/^gallery-image\//, 'gallery-images/gallery-image/');
        console.log('🔍 Updating old path to new nested structure:', r2Key);
      } else {
        // No prefix, add the full nested structure
        r2Key = `gallery-images/gallery-image/${filename}`;
        console.log('🔍 Adding full nested path:', r2Key);
      }
    } else {
      console.log('🔍 Fetching image from R2:', r2Key);
    }
    
    // Get from R2
    let object = await r2Bucket.get(r2Key);
    
    // Backward compatibility: try old formats if not found
    if (!object) {
      // Try gallery-images/ (without gallery-image/)
      if (r2Key.startsWith('gallery-images/gallery-image/')) {
        const fallbackKey = r2Key.replace('gallery-images/gallery-image/', 'gallery-images/');
        console.log('⚠️ Not found with nested path, trying gallery-images/:', fallbackKey);
        object = await r2Bucket.get(fallbackKey);
        if (object) r2Key = fallbackKey;
      }
      // Try gallery-image/ (old format)
      if (!object && r2Key.includes('gallery-images/')) {
        const fallbackKey = r2Key.replace('gallery-images/', 'gallery-image/');
        console.log('⚠️ Not found, trying old gallery-image/ format:', fallbackKey);
        object = await r2Bucket.get(fallbackKey);
        if (object) r2Key = fallbackKey;
      }
      // Try root level as last resort
      if (!object) {
        const rootKey = filename.split('/').pop(); // Get just the filename
        console.log('⚠️ Not found with any prefix, trying root level:', rootKey);
        object = await r2Bucket.get(rootKey);
        if (object) r2Key = rootKey;
      }
    }

    if (!object) {
      console.warn('⚠️ Image not found in R2:', r2Key);
      return new Response('Image not found', { status: 404, headers: corsHeaders });
    }

    // Determine Content-Type (from metadata or file extension)
    let contentType = 'image/jpeg'; // default
    if (object.httpMetadata && object.httpMetadata.contentType) {
      contentType = object.httpMetadata.contentType;
    } else {
      // Fallback to extension-based detection
      const ext = filename.split('.').pop()?.toLowerCase();
      contentType = getContentTypeFromExtension(ext || 'jpg');
    }

    // Set headers
    const headers = new Headers(corsHeaders);
    
    // Write HTTP metadata first (like HomeMadeDelights)
    if (object.httpMetadata) {
      object.writeHttpMetadata(headers);
    }
    
    // Always set Content-Type explicitly
    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'public, max-age=3600, must-revalidate');
    
    // Set Content-Length if available
    if (object.size) {
      headers.set('Content-Length', object.size.toString());
    }
    
    // Set ETag if available
    if (object.httpEtag) {
      headers.set('ETag', object.httpEtag);
    }

    console.log('✅ Serving image:', r2Key, 'Content-Type:', contentType, 'Size:', object.size, 'bytes');

    // Stream response
    if (!object.body) {
      console.error('❌ Object body is null for:', r2Key);
      return new Response('Image data not available', {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
      });
    }

    return new Response(object.body, { headers });
  } catch (error) {
    console.error('Get image error:', error);
    return new Response('Error loading image: ' + error.message, { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' } 
    });
  }
}

