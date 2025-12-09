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
  
  // Log request method for debugging
  console.log('📥 Request:', request.method, path);

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
      const allEnvKeys = Object.keys(env);
      const missingBindings = [];
      if (!r2Bucket) missingBindings.push('R2 binding: gallery-imagessda');
      if (!kvStore) missingBindings.push('KV binding: GALLERY_SSDA');
      
      return new Response(
        JSON.stringify({ 
          error: 'R2 or KV bindings not configured',
          details: `Missing bindings: ${missingBindings.join(', ')}`,
          troubleshooting: [
            '1. Go to Cloudflare Dashboard → Pages → Your Site → Settings → Functions',
            '2. Add R2 Bucket binding:',
            '   - Variable name: gallery-imagessda (exact match, with hyphen)',
            '   - Select your R2 bucket',
            '3. Add KV Namespace binding:',
            '   - Variable name: GALLERY_SSDA (exact match, all caps)',
            '   - Select your KV namespace',
            '4. Save and REDEPLOY your site (bindings only work after redeployment)',
            '5. Available environment keys: ' + allEnvKeys.join(', ')
          ].join('\n')
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Route handlers (using full path like HomeMadeDelights)
    // Check for method mismatches first to return proper 405 errors
    
    if (path === '/api/upload') {
      console.log('🔍 Upload endpoint - Received method:', request.method, 'Expected: POST');
      if (request.method !== 'POST') {
        console.warn('❌ Method mismatch for /api/upload:', request.method);
        return new Response(
          JSON.stringify({ 
            error: 'Method Not Allowed',
            details: `Endpoint /api/upload only accepts POST requests, but received ${request.method}`,
            allowedMethods: ['POST']
          }),
          { 
            status: 405, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json',
              'Allow': 'POST'
            } 
          }
        );
      }
      console.log('✅ Method OK, proceeding with upload handler');
      return handleUpload(request, r2Bucket, kvStore, corsHeaders);
    } else if (path === '/api/gallery') {
      if (request.method !== 'GET') {
        return new Response(
          JSON.stringify({ 
            error: 'Method Not Allowed',
            details: `Endpoint /api/gallery only accepts GET requests, but received ${request.method}`,
            allowedMethods: ['GET']
          }),
          { 
            status: 405, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json',
              'Allow': 'GET'
            } 
          }
        );
      }
      return handleGetGallery(kvStore, r2Bucket, corsHeaders);
    } else if (path === '/api/groups') {
      if (request.method !== 'GET') {
        return new Response(
          JSON.stringify({ 
            error: 'Method Not Allowed',
            details: `Endpoint /api/groups only accepts GET requests, but received ${request.method}`,
            allowedMethods: ['GET']
          }),
          { 
            status: 405, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json',
              'Allow': 'GET'
            } 
          }
        );
      }
      return handleGetGroups(kvStore, corsHeaders);
    } else if (path.startsWith('/api/delete/')) {
      if (request.method !== 'DELETE') {
        const imageId = path.replace('/api/delete/', '');
        return new Response(
          JSON.stringify({ 
            error: 'Method Not Allowed',
            details: `Endpoint /api/delete/${imageId} only accepts DELETE requests, but received ${request.method}`,
            allowedMethods: ['DELETE']
          }),
          { 
            status: 405, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json',
              'Allow': 'DELETE'
            } 
          }
        );
      }
      const imageId = path.replace('/api/delete/', '');
      return handleDeleteImage(imageId, r2Bucket, kvStore, corsHeaders);
    } else if (path.startsWith('/api/delete-group/')) {
      if (request.method !== 'DELETE') {
        const groupName = decodeURIComponent(path.replace('/api/delete-group/', ''));
        return new Response(
          JSON.stringify({ 
            error: 'Method Not Allowed',
            details: `Endpoint /api/delete-group/${groupName} only accepts DELETE requests, but received ${request.method}`,
            allowedMethods: ['DELETE']
          }),
          { 
            status: 405, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json',
              'Allow': 'DELETE'
            } 
          }
        );
      }
      const groupName = decodeURIComponent(path.replace('/api/delete-group/', ''));
      return handleDeleteGroup(groupName, r2Bucket, kvStore, corsHeaders);
    } else if (path.startsWith('/api/image/')) {
      if (request.method !== 'GET') {
        return new Response(
          JSON.stringify({ 
            error: 'Method Not Allowed',
            details: `Endpoint /api/image/* only accepts GET requests, but received ${request.method}`,
            allowedMethods: ['GET']
          }),
          { 
            status: 405, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json',
              'Allow': 'GET'
            } 
          }
        );
      }
      // Extract the filename/path after /api/image/
      // This can be a simple filename or a path like gallery-images/gallery-image/image-123.jpg
      let filename = path.substring('/api/image/'.length);
      
      // Handle query parameters if any
      if (filename.includes('?')) {
        filename = filename.split('?')[0];
      }
      
      // URL decode the filename to handle encoded characters
      // This will properly decode paths like gallery-images/gallery-image/image-123.jpg
      try {
        filename = decodeURIComponent(filename);
      } catch (e) {
        console.warn('Failed to decode filename, using as-is:', filename, e);
      }
      
      return handleGetImage(filename, r2Bucket, corsHeaders);
    } else {
      return new Response(
        JSON.stringify({ error: 'Not found', details: `Path ${path} does not exist` }),
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

    console.log('📋 FormData received:', {
      group: group,
      imagesCount: images.length,
      imageTypes: images.map(img => ({
        type: typeof img,
        constructor: img?.constructor?.name,
        isFile: img instanceof File,
        isBlob: img instanceof Blob,
        name: img?.name
      }))
    });

    if (images.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No images provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const uploadedImages = [];

    for (let i = 0; i < images.length; i++) {
      const imageFile = images[i];
      
      // Check if it's a valid file-like object (File or Blob)
      // Cloudflare Workers might use Blob instead of File
      if (!imageFile) {
        console.warn(`⚠️ Image ${i} is null or undefined`);
        continue;
      }
      
      const isFile = imageFile instanceof File;
      const isBlob = imageFile instanceof Blob;
      
      if (!isFile && !isBlob) {
        console.error(`❌ Image ${i} is not a File or Blob:`, {
          type: typeof imageFile,
          constructor: imageFile.constructor?.name,
          value: imageFile
        });
        continue;
      }
      
      console.log(`✅ Processing image ${i}:`, {
        name: imageFile.name,
        type: imageFile.type,
        size: imageFile.size,
        isFile: isFile,
        isBlob: isBlob
      });

      // Generate unique ID
      const imageId = `${Date.now()}-${i}-${Math.random().toString(36).substring(2, 15)}`;
      // Get file extension from name if available, otherwise guess from content type
      let fileExtension = 'jpg';
      if (imageFile.name) {
        fileExtension = imageFile.name.split('.').pop() || 'jpg';
      } else if (imageFile.type) {
        // Guess extension from MIME type
        const extMap = {
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/gif': 'gif',
          'image/webp': 'webp',
          'image/svg+xml': 'svg'
        };
        fileExtension = extMap[imageFile.type] || 'jpg';
      }
      const imageName = `image-${imageId}.${fileExtension}`;
      // Store in R2 with gallery-imagessda/ directory structure
      // Make sure we don't double-prefix
      const r2Key = imageName.startsWith('gallery-imagessda/') 
        ? imageName 
        : `gallery-imagessda/${imageName}`;
      
      console.log('📝 Generated R2 key for upload:', r2Key);

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

      console.log('📤 Uploading to R2 with key:', r2Key);
      console.log('   Content-Type:', contentType, 'Size:', fileBody.byteLength);
      console.log('   Full R2 path will be:', r2Key);

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

      // Get public URL - encode the R2 key to handle special characters and slashes
      const encodedR2Key = encodeURIComponent(r2Key).replace(/%2F/g, '/'); // Keep slashes unencoded for path structure
      const imageUrl = `/api/image/${r2Key}`; // Use original r2Key, the API will handle encoding

      // Store metadata in KV
      const metadata = {
        id: imageId,
        fileName: r2Key, // Store full R2 key including directory: gallery-imagessda/image-123.jpg
        url: imageUrl,
        group: group,
        uploadedAt: new Date().toISOString(),
        size: imageFile.size || fileBody.byteLength,
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
      totalImages: index.length,
      uploadedImageIds: uploadedImages.map(img => img.id)
    });
    
    if (uploadedImages.length === 0) {
      console.error('⚠️ WARNING: No images were successfully uploaded!');
      console.error('   This means all files were skipped. Check logs above for details.');
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'No images were processed. All files were skipped.',
          images: []
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, images: uploadedImages }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Upload error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Upload failed',
        details: error.message || 'An unexpected error occurred during upload',
        troubleshooting: error.message && error.message.includes('binding') 
          ? 'Check R2 binding: gallery-imagessda and KV binding: GALLERY_SSDA'
          : 'Please check your network connection and try again. If the problem persists, check the browser console for more details.'
      }),
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
      return new Response(
        JSON.stringify({ 
          error: 'R2 binding not configured',
          details: 'Required R2 binding: gallery-imagessda',
          troubleshooting: [
            'Configure R2 binding in Cloudflare Pages:',
            'Settings → Functions → Bindings → Add R2 Bucket',
            'Variable name: gallery-imagessda (exact match)'
          ].join('\n')
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    // The filename from URL should include gallery-imagessda/ prefix
    // Handle backward compatibility with old formats
    console.log('🔍 handleGetImage - Received filename:', filename);
    let r2Key = filename;
    
    // If filename already starts with gallery-imagessda/, use it as-is
    if (filename.startsWith('gallery-imagessda/')) {
      r2Key = filename;
      console.log('✅ Filename already has gallery-imagessda/ prefix, using as-is:', r2Key);
    } else {
      // Try different formats for backward compatibility
      if (filename.startsWith('gallery-images/gallery-image/')) {
        // Old format: gallery-images/gallery-image/image-123.jpg -> gallery-imagessda/image-123.jpg
        const imageName = filename.replace('gallery-images/gallery-image/', '');
        r2Key = `gallery-imagessda/${imageName}`;
        console.log('🔍 Converting old format to gallery-imagessda:', r2Key);
      } else if (filename.startsWith('gallery-images/')) {
        // Old format: gallery-images/image-123.jpg -> gallery-imagessda/image-123.jpg
        const imageName = filename.replace('gallery-images/', '');
        r2Key = `gallery-imagessda/${imageName}`;
        console.log('🔍 Converting old format to gallery-imagessda:', r2Key);
      } else if (filename.startsWith('gallery-image/')) {
        // Old format: gallery-image/image-123.jpg -> gallery-imagessda/image-123.jpg
        const imageName = filename.replace('gallery-image/', '');
        r2Key = `gallery-imagessda/${imageName}`;
        console.log('🔍 Converting old format to gallery-imagessda:', r2Key);
      } else {
        // No prefix, add the gallery-imagessda/ directory (just the filename)
        // Make sure we're not adding it if filename already contains it
        if (!filename.includes('gallery-imagessda')) {
          r2Key = `gallery-imagessda/${filename}`;
          console.log('🔍 Adding gallery-imagessda/ directory to filename:', r2Key);
        } else {
          r2Key = filename;
          console.log('⚠️ Filename already contains gallery-imagessda, using as-is:', r2Key);
        }
      }
    }
    
    console.log('📦 Final R2 key to fetch:', r2Key);
    
    // Get from R2
    let object = await r2Bucket.get(r2Key);
    
    // Backward compatibility: try old formats if not found
    if (!object) {
      // Try old gallery-images/gallery-image/ format
      if (r2Key.startsWith('gallery-imagessda/')) {
        const imageName = r2Key.replace('gallery-imagessda/', '');
        const fallbackKey = `gallery-images/gallery-image/${imageName}`;
        console.log('⚠️ Not found, trying old nested format:', fallbackKey);
        object = await r2Bucket.get(fallbackKey);
        if (object) r2Key = fallbackKey;
      }
      // Try gallery-images/ format
      if (!object && r2Key.startsWith('gallery-imagessda/')) {
        const imageName = r2Key.replace('gallery-imagessda/', '');
        const fallbackKey = `gallery-images/${imageName}`;
        console.log('⚠️ Not found, trying old gallery-images/ format:', fallbackKey);
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
      return new Response(
        JSON.stringify({ 
          error: 'Image not found',
          details: `Image "${r2Key}" not found in R2 bucket`,
          troubleshooting: [
            'Possible causes:',
            '1. Image was deleted',
            '2. Image was never uploaded successfully',
            '3. R2 key path mismatch',
            '4. Check R2 bucket: gallery-imagessda'
          ].join('\n')
        }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
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

