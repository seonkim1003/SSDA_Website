// Gallery Configuration
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 100;
const API_BASE = '/api';
const GALLERY_PASSWORD = 'SSDA2025'; // Change this to your desired password

// State
let isAuthenticated = false;
let allImages = [];
let currentGroup = null;
let currentImageIndex = 0;
let selectedFiles = [];
let previewFiles = [];

// DOM Elements
const passwordModal = document.getElementById('password-modal');
const passwordInput = document.getElementById('password-input');
const passwordSubmitBtn = document.getElementById('password-submit-btn');
const passwordError = document.getElementById('password-error');
const galleryMainContent = document.getElementById('gallery-main-content');
const uploadArea = document.getElementById('upload-area');
const fileInput = document.getElementById('file-input');
const previewContainer = document.getElementById('preview-container');
const previewGrid = document.getElementById('preview-grid');
const clearPreviewBtn = document.getElementById('clear-preview');
const uploadBtn = document.getElementById('upload-btn');
const uploadProgress = document.getElementById('upload-progress');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const uploadSuccess = document.getElementById('upload-success');
const successMessage = document.getElementById('success-message');
const galleryGrid = document.getElementById('gallery-grid');
const loadingSpinner = document.getElementById('loading-spinner');
const emptyGallery = document.getElementById('empty-gallery');
const refreshGalleryBtn = document.getElementById('refresh-gallery-btn');
const newGroupTab = document.querySelector('.group-tab:has(input[value="new"])');
const existingGroupTab = document.querySelector('.group-tab:has(input[value="existing"])');
const slideshowModal = document.getElementById('slideshow-modal');
const slideshowImage = document.getElementById('slideshow-image');
const slideshowClose = document.getElementById('slideshow-close');
const slideshowPrev = document.getElementById('slideshow-prev');
const slideshowNext = document.getElementById('slideshow-next');
const slideshowCounter = document.getElementById('slideshow-counter');
const deleteImageBtn = document.getElementById('delete-image-btn');
const newGroupRadio = document.getElementById('new-group-radio');
const existingGroupRadio = document.getElementById('existing-group-radio');
const groupTitleInput = document.getElementById('group-title-input');
const existingGroupSelect = document.getElementById('existing-group-select');

// Check authentication on load
document.addEventListener('DOMContentLoaded', () => {
    const savedAuth = sessionStorage.getItem('gallery_authenticated');
    if (savedAuth === 'true') {
        isAuthenticated = true;
        showGallery();
    } else {
        showPasswordModal();
    }
});

// Password Protection
function showPasswordModal() {
    passwordModal.style.display = 'flex';
    passwordInput.focus();
}

function hidePasswordModal() {
    passwordModal.style.display = 'none';
}

function showGallery() {
    hidePasswordModal();
    galleryMainContent.style.display = 'block';
    loadGallery();
}

passwordSubmitBtn.addEventListener('click', () => {
    const password = passwordInput.value.trim();
    if (password === GALLERY_PASSWORD) {
        isAuthenticated = true;
        sessionStorage.setItem('gallery_authenticated', 'true');
        showGallery();
    } else {
        passwordError.textContent = 'Incorrect password. Please try again.';
        passwordError.style.display = 'block';
        passwordInput.value = '';
        passwordInput.focus();
    }
});

passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        passwordSubmitBtn.click();
    }
});

// File Upload
uploadArea.addEventListener('click', () => {
    fileInput.click();
});

uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'));
    handleFiles(files);
});

fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    handleFiles(files);
});

function handleFiles(files) {
    const validFiles = [];
    
    for (const file of files) {
        if (!file.type.startsWith('image/')) {
            alert(`${file.name} is not an image file.`);
            continue;
        }
        if (file.size > MAX_FILE_SIZE) {
            alert(`${file.name} is too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
            continue;
        }
        validFiles.push(file);
    }
    
    if (validFiles.length === 0) return;
    
    if (selectedFiles.length + validFiles.length > MAX_FILES) {
        alert(`Maximum ${MAX_FILES} files allowed.`);
        return;
    }
    
    selectedFiles.push(...validFiles);
    updatePreview();
}

function updatePreview() {
    const previewCountEl = document.getElementById('preview-count');
    
    if (selectedFiles.length === 0) {
        previewContainer.style.display = 'none';
        previewFiles = [];
        if (previewCountEl) {
            previewCountEl.textContent = '';
        }
        return;
    }
    
    previewContainer.style.display = 'block';
    previewGrid.innerHTML = '';
    previewFiles = [];
    
    // Update preview count
    if (previewCountEl) {
        previewCountEl.textContent = selectedFiles.length;
    }
    
    selectedFiles.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const previewItem = document.createElement('div');
            previewItem.className = 'preview-item';
            previewItem.innerHTML = `
                <img src="${e.target.result}" alt="Preview">
                <button class="preview-remove" data-index="${index}">×</button>
            `;
            previewGrid.appendChild(previewItem);
            
            const removeBtn = previewItem.querySelector('.preview-remove');
            removeBtn.addEventListener('click', () => {
                selectedFiles.splice(index, 1);
                updatePreview();
            });
        };
        reader.readAsDataURL(file);
        previewFiles.push({ file, index });
    });
    
    loadExistingGroups();
}

clearPreviewBtn.addEventListener('click', () => {
    selectedFiles = [];
    fileInput.value = '';
    updatePreview();
});

// Group Selection
newGroupRadio.addEventListener('change', () => {
    if (newGroupRadio.checked) {
        groupTitleInput.style.display = 'block';
        existingGroupSelect.style.display = 'none';
        groupTitleInput.value = '';
        if (newGroupTab) newGroupTab.classList.add('active');
        if (existingGroupTab) existingGroupTab.classList.remove('active');
    }
});

existingGroupRadio.addEventListener('change', () => {
    if (existingGroupRadio.checked) {
        groupTitleInput.style.display = 'none';
        existingGroupSelect.style.display = 'block';
        if (newGroupTab) newGroupTab.classList.remove('active');
        if (existingGroupTab) existingGroupTab.classList.add('active');
    }
});

async function loadExistingGroups() {
    try {
        const response = await fetch(`${API_BASE}/groups`);
        if (response.ok) {
            const groups = await response.json();
            existingGroupSelect.innerHTML = '<option value=""></option>';
            groups.forEach(group => {
                const option = document.createElement('option');
                option.value = group;
                option.textContent = group;
                existingGroupSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading groups:', error);
    }
}

// Upload Images
uploadBtn.addEventListener('click', async () => {
    if (selectedFiles.length === 0) {
        alert('Please select at least one image to upload.');
        return;
    }
    
    let groupTitle = '';
    if (newGroupRadio.checked) {
        groupTitle = groupTitleInput.value.trim();
        if (!groupTitle) {
            alert('Please enter a group title.');
            return;
        }
    } else {
        groupTitle = existingGroupSelect.value;
        if (!groupTitle) {
            alert('Please select an existing group.');
            return;
        }
    }
    
    uploadBtn.disabled = true;
    uploadProgress.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = 'Uploading...';
    
    const formData = new FormData();
    selectedFiles.forEach(({ file }) => {
        formData.append('images', file);
    });
    formData.append('group', groupTitle);
    
    try {
        const response = await fetch(`${API_BASE}/upload`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error('Upload failed');
        }
        
        const result = await response.json();
        progressFill.style.width = '100%';
        progressText.textContent = 'Upload complete!';
        
        setTimeout(() => {
            uploadProgress.style.display = 'none';
            uploadSuccess.style.display = 'block';
            uploadSuccess.classList.add('success');
            selectedFiles = [];
            fileInput.value = '';
            updatePreview();
            
            setTimeout(() => {
                uploadSuccess.style.display = 'none';
                uploadBtn.disabled = false;
                loadGallery();
            }, 2000);
        }, 500);
        
    } catch (error) {
        console.error('Upload error:', error);
        alert('Upload failed. Please try again.');
        uploadProgress.style.display = 'none';
        uploadBtn.disabled = false;
    }
});

// Load Gallery
async function loadGallery() {
    loadingSpinner.style.display = 'flex';
    emptyGallery.style.display = 'none';
    galleryGrid.innerHTML = '';
    galleryGrid.appendChild(loadingSpinner);
    
    try {
        const response = await fetch(`${API_BASE}/gallery`);
        if (!response.ok) {
            throw new Error('Failed to load gallery');
        }
        
        const data = await response.json();
        allImages = data.images || [];
        
        loadingSpinner.style.display = 'none';
        
        if (allImages.length === 0) {
            emptyGallery.style.display = 'block';
            galleryGrid.appendChild(emptyGallery);
            return;
        }
        
        // Group images by group
        const groupedImages = {};
        allImages.forEach(img => {
            const group = img.group || 'Ungrouped';
            if (!groupedImages[group]) {
                groupedImages[group] = [];
            }
            groupedImages[group].push(img);
        });
        
        // Display groups
        Object.keys(groupedImages).sort().forEach(groupName => {
            const groupCard = document.createElement('div');
            groupCard.className = 'gallery-item-card';
            groupCard.innerHTML = `
                <img src="${groupedImages[groupName][0].url}" alt="${groupName}">
                <div class="gallery-item-overlay">
                    <h3 class="gallery-item-title">${groupName}</h3>
                    <p class="gallery-item-count">${groupedImages[groupName].length} ${groupedImages[groupName].length === 1 ? 'image' : 'images'}</p>
                </div>
                <button class="gallery-item-delete" data-group="${groupName}" title="Delete group">🗑️</button>
            `;
            
            groupCard.addEventListener('click', (e) => {
                if (e.target.classList.contains('gallery-item-delete')) {
                    e.stopPropagation();
                    if (confirm(`Delete all images in "${groupName}"?`)) {
                        deleteGroup(groupName);
                    }
                    return;
                }
                showGroupSlideshow(groupName, groupedImages[groupName]);
            });
            
            galleryGrid.appendChild(groupCard);
        });
        
    } catch (error) {
        console.error('Error loading gallery:', error);
        loadingSpinner.style.display = 'none';
        galleryGrid.innerHTML = '<p style="text-align: center; color: var(--text-color);">Error loading gallery. Please try again.</p>';
    }
}

refreshGalleryBtn.addEventListener('click', () => {
    loadGallery();
});

// Slideshow
function showGroupSlideshow(groupName, images) {
    currentGroup = images;
    currentImageIndex = 0;
    showSlideshow();
}

function showSlideshow() {
    if (currentGroup.length === 0) return;
    
    const image = currentGroup[currentImageIndex];
    slideshowImage.src = image.url;
    slideshowCounter.textContent = `${currentImageIndex + 1} / ${currentGroup.length}`;
    slideshowModal.classList.add('active');
    document.body.classList.add('body-no-scroll');
    
    deleteImageBtn.onclick = () => {
        if (confirm('Delete this image?')) {
            deleteImage(image.id);
        }
    };
}

function hideSlideshow() {
    slideshowModal.classList.remove('active');
    document.body.classList.remove('body-no-scroll');
    currentGroup = null;
    currentImageIndex = 0;
}

slideshowClose.addEventListener('click', hideSlideshow);

slideshowPrev.addEventListener('click', () => {
    if (currentImageIndex > 0) {
        currentImageIndex--;
    } else {
        currentImageIndex = currentGroup.length - 1;
    }
    showSlideshow();
});

slideshowNext.addEventListener('click', () => {
    if (currentImageIndex < currentGroup.length - 1) {
        currentImageIndex++;
    } else {
        currentImageIndex = 0;
    }
    showSlideshow();
});

slideshowModal.addEventListener('click', (e) => {
    if (e.target === slideshowModal) {
        hideSlideshow();
    }
});

document.addEventListener('keydown', (e) => {
    if (!slideshowModal.classList.contains('active')) return;
    
    if (e.key === 'Escape') {
        hideSlideshow();
    } else if (e.key === 'ArrowLeft') {
        slideshowPrev.click();
    } else if (e.key === 'ArrowRight') {
        slideshowNext.click();
    }
});

// Delete Functions
async function deleteImage(imageId) {
    try {
        const response = await fetch(`${API_BASE}/delete/${imageId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            throw new Error('Delete failed');
        }
        
        hideSlideshow();
        loadGallery();
    } catch (error) {
        console.error('Delete error:', error);
        alert('Failed to delete image. Please try again.');
    }
}

async function deleteGroup(groupName) {
    try {
        const response = await fetch(`${API_BASE}/delete-group/${encodeURIComponent(groupName)}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            throw new Error('Delete failed');
        }
        
        loadGallery();
    } catch (error) {
        console.error('Delete error:', error);
        alert('Failed to delete group. Please try again.');
    }
}

