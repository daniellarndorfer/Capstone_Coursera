const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const { body, validationResult } = require('express-validator');

const router = express.Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/temp';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 20 // Maximum 20 files
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// @route   POST /api/upload/images
// @desc    Upload multiple images
// @access  Private
router.post('/images', upload.array('images', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        error: 'No files uploaded'
      });
    }

    const uploadPromises = req.files.map(async (file) => {
      try {
        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(file.path, {
          folder: 'second-hand-listings',
          resource_type: 'auto',
          transformation: [
            { width: 1200, height: 1200, crop: 'limit' },
            { quality: 'auto' },
            { fetch_format: 'auto' }
          ]
        });

        // Create thumbnail
        const thumbnailResult = await cloudinary.uploader.upload(file.path, {
          folder: 'second-hand-listings/thumbnails',
          resource_type: 'auto',
          transformation: [
            { width: 300, height: 300, crop: 'fill' },
            { quality: 'auto' },
            { fetch_format: 'auto' }
          ]
        });

        // Delete local file
        fs.unlinkSync(file.path);

        return {
          success: true,
          url: result.secure_url,
          thumbnailUrl: thumbnailResult.secure_url,
          publicId: result.public_id,
          thumbnailPublicId: thumbnailResult.public_id,
          filename: file.filename,
          originalName: file.originalname,
          size: file.size,
          format: result.format,
          width: result.width,
          height: result.height
        };
      } catch (uploadError) {
        console.error('Individual upload error:', uploadError);
        
        // Delete local file if it exists
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
        
        return {
          success: false,
          error: uploadError.message,
          filename: file.filename,
          originalName: file.originalname
        };
      }
    });

    const results = await Promise.all(uploadPromises);
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    res.json({
      message: `${successful.length} images uploaded successfully${failed.length > 0 ? `, ${failed.length} failed` : ''}`,
      images: successful,
      failed: failed.length > 0 ? failed : undefined,
      total: req.files.length,
      successful: successful.length,
      failed: failed.length
    });

  } catch (error) {
    console.error('Upload images error:', error);
    
    // Clean up files on error
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }
    
    res.status(500).json({
      error: 'Server error while uploading images'
    });
  }
});

// @route   POST /api/upload/image
// @desc    Upload single image
// @access  Private
router.post('/image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded'
      });
    }

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'second-hand-listings',
      resource_type: 'auto',
      transformation: [
        { width: 1200, height: 1200, crop: 'limit' },
        { quality: 'auto' },
        { fetch_format: 'auto' }
      ]
    });

    // Create thumbnail
    const thumbnailResult = await cloudinary.uploader.upload(req.file.path, {
      folder: 'second-hand-listings/thumbnails',
      resource_type: 'auto',
      transformation: [
        { width: 300, height: 300, crop: 'fill' },
        { quality: 'auto' },
        { fetch_format: 'auto' }
      ]
    });

    // Delete local file
    fs.unlinkSync(req.file.path);

    res.json({
      message: 'Image uploaded successfully',
      image: {
        url: result.secure_url,
        thumbnailUrl: thumbnailResult.secure_url,
        publicId: result.public_id,
        thumbnailPublicId: thumbnailResult.public_id,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        format: result.format,
        width: result.width,
        height: result.height
      }
    });

  } catch (error) {
    console.error('Upload image error:', error);
    
    // Clean up file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({
      error: 'Server error while uploading image'
    });
  }
});

// @route   DELETE /api/upload/image/:publicId
// @desc    Delete image from Cloudinary
// @access  Private
router.delete('/image/:publicId', async (req, res) => {
  try {
    const publicId = req.params.publicId;
    
    if (!publicId) {
      return res.status(400).json({
        error: 'Public ID is required'
      });
    }

    // Delete from Cloudinary
    await cloudinary.uploader.destroy(publicId);
    
    // Try to delete thumbnail as well
    try {
      const thumbnailPublicId = publicId.replace('second-hand-listings/', 'second-hand-listings/thumbnails/');
      await cloudinary.uploader.destroy(thumbnailPublicId);
    } catch (thumbnailError) {
      console.warn('Thumbnail deletion failed:', thumbnailError);
    }

    res.json({
      message: 'Image deleted successfully'
    });

  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({
      error: 'Server error while deleting image'
    });
  }
});

// @route   POST /api/upload/optimize-image
// @desc    Optimize existing image
// @access  Private
router.post('/optimize-image', [
  body('publicId')
    .notEmpty()
    .withMessage('Public ID is required'),
  body('transformations')
    .optional()
    .isArray()
    .withMessage('Transformations must be an array'),
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { publicId, transformations = [] } = req.body;

    // Default transformations
    const defaultTransformations = [
      { width: 1200, height: 1200, crop: 'limit' },
      { quality: 'auto' },
      { fetch_format: 'auto' }
    ];

    // Apply transformations
    const optimizedUrl = cloudinary.url(publicId, {
      transformation: transformations.length > 0 ? transformations : defaultTransformations
    });

    res.json({
      message: 'Image optimized successfully',
      optimizedUrl,
      originalUrl: cloudinary.url(publicId)
    });

  } catch (error) {
    console.error('Optimize image error:', error);
    res.status(500).json({
      error: 'Server error while optimizing image'
    });
  }
});

// @route   POST /api/upload/batch-optimize
// @desc    Batch optimize multiple images
// @access  Private
router.post('/batch-optimize', [
  body('images')
    .isArray({ min: 1 })
    .withMessage('Images array is required'),
  body('images.*.publicId')
    .notEmpty()
    .withMessage('Public ID is required for each image'),
  body('transformations')
    .optional()
    .isArray()
    .withMessage('Transformations must be an array'),
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { images, transformations = [] } = req.body;

    // Default transformations
    const defaultTransformations = [
      { width: 1200, height: 1200, crop: 'limit' },
      { quality: 'auto' },
      { fetch_format: 'auto' }
    ];

    const optimizedImages = images.map(image => {
      const optimizedUrl = cloudinary.url(image.publicId, {
        transformation: transformations.length > 0 ? transformations : defaultTransformations
      });

      return {
        publicId: image.publicId,
        originalUrl: cloudinary.url(image.publicId),
        optimizedUrl
      };
    });

    res.json({
      message: `${optimizedImages.length} images optimized successfully`,
      images: optimizedImages
    });

  } catch (error) {
    console.error('Batch optimize error:', error);
    res.status(500).json({
      error: 'Server error while batch optimizing images'
    });
  }
});

// @route   POST /api/upload/resize-image
// @desc    Resize image to specific dimensions
// @access  Private
router.post('/resize-image', [
  body('publicId')
    .notEmpty()
    .withMessage('Public ID is required'),
  body('width')
    .isInt({ min: 1, max: 4000 })
    .withMessage('Width must be between 1 and 4000 pixels'),
  body('height')
    .isInt({ min: 1, max: 4000 })
    .withMessage('Height must be between 1 and 4000 pixels'),
  body('crop')
    .optional()
    .isIn(['scale', 'fit', 'limit', 'fill', 'pad'])
    .withMessage('Invalid crop mode'),
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { publicId, width, height, crop = 'limit' } = req.body;

    // Resize image
    const resizedUrl = cloudinary.url(publicId, {
      transformation: [
        { width, height, crop },
        { quality: 'auto' },
        { fetch_format: 'auto' }
      ]
    });

    res.json({
      message: 'Image resized successfully',
      resizedUrl,
      originalUrl: cloudinary.url(publicId),
      dimensions: { width, height, crop }
    });

  } catch (error) {
    console.error('Resize image error:', error);
    res.status(500).json({
      error: 'Server error while resizing image'
    });
  }
});

// @route   GET /api/upload/image-info/:publicId
// @desc    Get image information
// @access  Private
router.get('/image-info/:publicId', async (req, res) => {
  try {
    const publicId = req.params.publicId;
    
    if (!publicId) {
      return res.status(400).json({
        error: 'Public ID is required'
      });
    }

    // Get image info from Cloudinary
    const result = await cloudinary.api.resource(publicId);

    res.json({
      message: 'Image information retrieved successfully',
      info: {
        publicId: result.public_id,
        url: result.secure_url,
        format: result.format,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
        createdAt: result.created_at,
        type: result.type,
        resourceType: result.resource_type
      }
    });

  } catch (error) {
    console.error('Get image info error:', error);
    
    if (error.http_code === 404) {
      return res.status(404).json({
        error: 'Image not found'
      });
    }
    
    res.status(500).json({
      error: 'Server error while getting image information'
    });
  }
});

// @route   POST /api/upload/create-variants
// @desc    Create multiple variants of an image
// @access  Private
router.post('/create-variants', [
  body('publicId')
    .notEmpty()
    .withMessage('Public ID is required'),
  body('variants')
    .isArray({ min: 1 })
    .withMessage('Variants array is required'),
  body('variants.*.name')
    .notEmpty()
    .withMessage('Variant name is required'),
  body('variants.*.transformations')
    .isArray()
    .withMessage('Transformations must be an array'),
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { publicId, variants } = req.body;

    const variantResults = variants.map(variant => {
      const variantUrl = cloudinary.url(publicId, {
        transformation: variant.transformations
      });

      return {
        name: variant.name,
        url: variantUrl,
        transformations: variant.transformations
      };
    });

    res.json({
      message: `${variantResults.length} variants created successfully`,
      originalUrl: cloudinary.url(publicId),
      variants: variantResults
    });

  } catch (error) {
    console.error('Create variants error:', error);
    res.status(500).json({
      error: 'Server error while creating image variants'
    });
  }
});

// @route   POST /api/upload/cleanup-temp
// @desc    Clean up temporary upload files
// @access  Private
router.post('/cleanup-temp', async (req, res) => {
  try {
    const tempDir = path.join(__dirname, '../uploads/temp');
    
    if (!fs.existsSync(tempDir)) {
      return res.json({
        message: 'No temporary files to clean up'
      });
    }

    const files = fs.readdirSync(tempDir);
    const cutoffTime = Date.now() - (60 * 60 * 1000); // 1 hour ago
    let deletedCount = 0;

    files.forEach(file => {
      const filePath = path.join(tempDir, file);
      const stats = fs.statSync(filePath);
      
      if (stats.mtime.getTime() < cutoffTime) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    });

    res.json({
      message: `Cleaned up ${deletedCount} temporary files`
    });

  } catch (error) {
    console.error('Cleanup temp error:', error);
    res.status(500).json({
      error: 'Server error while cleaning up temporary files'
    });
  }
});

// @route   GET /api/upload/storage-info
// @desc    Get storage usage information
// @access  Private
router.get('/storage-info', async (req, res) => {
  try {
    // Get Cloudinary usage info
    const usage = await cloudinary.api.usage();
    
    // Get folder info
    const folderInfo = await cloudinary.api.resources({
      type: 'upload',
      prefix: 'second-hand-listings/',
      max_results: 500
    });

    res.json({
      message: 'Storage information retrieved successfully',
      usage: {
        credits: usage.credits,
        usedCredits: usage.credits_used,
        limit: usage.limit,
        usedStorage: usage.storage.used,
        storageLimit: usage.storage.limit,
        transformations: usage.transformations.used,
        transformationsLimit: usage.transformations.limit
      },
      folder: {
        totalFiles: folderInfo.total_count,
        files: folderInfo.resources.length
      }
    });

  } catch (error) {
    console.error('Get storage info error:', error);
    res.status(500).json({
      error: 'Server error while getting storage information'
    });
  }
});

module.exports = router;