const express = require('express');
const { body, validationResult, query } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;

const Item = require('../models/Item');
const User = require('../models/User');

const router = express.Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/items';
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
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 10 // Maximum 10 files
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Item validation rules
const itemValidation = [
  body('title')
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage('Title must be between 5 and 200 characters'),
  body('description')
    .trim()
    .isLength({ min: 20, max: 5000 })
    .withMessage('Description must be between 20 and 5000 characters'),
  body('category.main')
    .notEmpty()
    .withMessage('Main category is required'),
  body('condition')
    .isIn(['new', 'like_new', 'very_good', 'good', 'acceptable', 'for_parts'])
    .withMessage('Invalid condition'),
  body('price.amount')
    .isFloat({ min: 0.01 })
    .withMessage('Price must be greater than 0'),
  body('price.currency')
    .optional()
    .isIn(['EUR', 'USD', 'GBP'])
    .withMessage('Invalid currency'),
  body('location.city')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('City must be between 2 and 100 characters'),
  body('availability.quantity')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Quantity must be a non-negative integer'),
];

// @route   GET /api/items
// @desc    Get all items for authenticated user
// @access  Private
router.get('/', [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('status')
    .optional()
    .isIn(['draft', 'active', 'sold', 'expired', 'deleted'])
    .withMessage('Invalid status'),
  query('category')
    .optional()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Category cannot be empty'),
  query('platform')
    .optional()
    .isIn(['ebay', 'willhaben'])
    .withMessage('Invalid platform'),
  query('sort')
    .optional()
    .isIn(['createdAt', 'price', 'title', 'status'])
    .withMessage('Invalid sort field'),
  query('order')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Invalid sort order'),
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

    const {
      page = 1,
      limit = 20,
      status,
      category,
      platform,
      search,
      sort = 'createdAt',
      order = 'desc'
    } = req.query;

    // Build query
    const query = {
      userId: req.user._id,
      isActive: true
    };

    if (status) {
      query.status = status;
    }

    if (category) {
      query['category.main'] = new RegExp(category, 'i');
    }

    if (platform) {
      query[`platforms.${platform}.enabled`] = true;
    }

    if (search) {
      query.$text = { $search: search };
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build sort object
    const sortObj = {};
    sortObj[sort] = order === 'asc' ? 1 : -1;

    // Execute query
    const items = await Item.find(query)
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('userId', 'username email');

    // Get total count
    const total = await Item.countDocuments(query);

    res.json({
      items,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get items error:', error);
    res.status(500).json({
      error: 'Server error while fetching items'
    });
  }
});

// @route   GET /api/items/:id
// @desc    Get single item by ID
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    const item = await Item.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isActive: true
    }).populate('userId', 'username email');

    if (!item) {
      return res.status(404).json({
        error: 'Item not found'
      });
    }

    res.json({
      item
    });

  } catch (error) {
    console.error('Get item error:', error);
    res.status(500).json({
      error: 'Server error while fetching item'
    });
  }
});

// @route   POST /api/items
// @desc    Create new item
// @access  Private
router.post('/', upload.array('images', 10), itemValidation, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    // Check subscription limits
    if (!req.user.canCreateListing()) {
      return res.status(403).json({
        error: 'Subscription limit reached. Please upgrade your plan.'
      });
    }

    const itemData = {
      ...req.body,
      userId: req.user._id,
      images: []
    };

    // Parse nested objects
    if (req.body.category) {
      itemData.category = typeof req.body.category === 'string' 
        ? JSON.parse(req.body.category) 
        : req.body.category;
    }

    if (req.body.price) {
      itemData.price = typeof req.body.price === 'string' 
        ? JSON.parse(req.body.price) 
        : req.body.price;
    }

    if (req.body.specifications) {
      itemData.specifications = typeof req.body.specifications === 'string' 
        ? JSON.parse(req.body.specifications) 
        : req.body.specifications;
    }

    if (req.body.shipping) {
      itemData.shipping = typeof req.body.shipping === 'string' 
        ? JSON.parse(req.body.shipping) 
        : req.body.shipping;
    }

    if (req.body.location) {
      itemData.location = typeof req.body.location === 'string' 
        ? JSON.parse(req.body.location) 
        : req.body.location;
    }

    if (req.body.availability) {
      itemData.availability = typeof req.body.availability === 'string' 
        ? JSON.parse(req.body.availability) 
        : req.body.availability;
    }

    if (req.body.platforms) {
      itemData.platforms = typeof req.body.platforms === 'string' 
        ? JSON.parse(req.body.platforms) 
        : req.body.platforms;
    }

    // Handle image uploads
    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        
        try {
          // Upload to Cloudinary
          const result = await cloudinary.uploader.upload(file.path, {
            folder: 'second-hand-listings',
            resource_type: 'auto'
          });

          itemData.images.push({
            url: result.secure_url,
            filename: file.filename,
            size: file.size,
            isPrimary: i === 0, // First image is primary
            cloudinaryId: result.public_id,
            order: i
          });

          // Delete local file
          fs.unlinkSync(file.path);
        } catch (uploadError) {
          console.error('Image upload error:', uploadError);
          // Continue with other images
        }
      }
    }

    // Create item
    const item = new Item(itemData);
    await item.save();

    // Update user statistics
    await req.user.updateStats({
      totalListings: req.user.statistics.totalListings + 1
    });

    // Emit socket event
    req.io.to(req.user._id.toString()).emit('item-created', {
      item: item.toObject()
    });

    res.status(201).json({
      message: 'Item created successfully',
      item
    });

  } catch (error) {
    console.error('Create item error:', error);
    res.status(500).json({
      error: 'Server error while creating item'
    });
  }
});

// @route   PUT /api/items/:id
// @desc    Update item
// @access  Private
router.put('/:id', upload.array('images', 10), itemValidation, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    // Find item
    const item = await Item.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isActive: true
    });

    if (!item) {
      return res.status(404).json({
        error: 'Item not found'
      });
    }

    // Update item data
    const updateData = { ...req.body };

    // Parse nested objects
    if (req.body.category) {
      updateData.category = typeof req.body.category === 'string' 
        ? JSON.parse(req.body.category) 
        : req.body.category;
    }

    if (req.body.price) {
      updateData.price = typeof req.body.price === 'string' 
        ? JSON.parse(req.body.price) 
        : req.body.price;
    }

    if (req.body.specifications) {
      updateData.specifications = typeof req.body.specifications === 'string' 
        ? JSON.parse(req.body.specifications) 
        : req.body.specifications;
    }

    if (req.body.shipping) {
      updateData.shipping = typeof req.body.shipping === 'string' 
        ? JSON.parse(req.body.shipping) 
        : req.body.shipping;
    }

    if (req.body.location) {
      updateData.location = typeof req.body.location === 'string' 
        ? JSON.parse(req.body.location) 
        : req.body.location;
    }

    if (req.body.availability) {
      updateData.availability = typeof req.body.availability === 'string' 
        ? JSON.parse(req.body.availability) 
        : req.body.availability;
    }

    if (req.body.platforms) {
      updateData.platforms = typeof req.body.platforms === 'string' 
        ? JSON.parse(req.body.platforms) 
        : req.body.platforms;
    }

    // Handle new image uploads
    if (req.files && req.files.length > 0) {
      const newImages = [];
      
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        
        try {
          // Upload to Cloudinary
          const result = await cloudinary.uploader.upload(file.path, {
            folder: 'second-hand-listings',
            resource_type: 'auto'
          });

          newImages.push({
            url: result.secure_url,
            filename: file.filename,
            size: file.size,
            isPrimary: item.images.length === 0 && i === 0, // First image is primary if no existing images
            cloudinaryId: result.public_id,
            order: item.images.length + i
          });

          // Delete local file
          fs.unlinkSync(file.path);
        } catch (uploadError) {
          console.error('Image upload error:', uploadError);
          // Continue with other images
        }
      }
      
      updateData.images = [...item.images, ...newImages];
    }

    // Update price history if price changed
    if (updateData.price && updateData.price.amount !== item.price.amount) {
      await item.updatePriceHistory(updateData.price.amount, 'manual');
    }

    // Update item
    Object.assign(item, updateData);
    await item.save();

    // Emit socket event
    req.io.to(req.user._id.toString()).emit('item-updated', {
      item: item.toObject()
    });

    res.json({
      message: 'Item updated successfully',
      item
    });

  } catch (error) {
    console.error('Update item error:', error);
    res.status(500).json({
      error: 'Server error while updating item'
    });
  }
});

// @route   DELETE /api/items/:id
// @desc    Delete item (soft delete)
// @access  Private
router.delete('/:id', async (req, res) => {
  try {
    const item = await Item.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isActive: true
    });

    if (!item) {
      return res.status(404).json({
        error: 'Item not found'
      });
    }

    // Soft delete
    item.isActive = false;
    item.status = 'deleted';
    await item.save();

    // Update user statistics
    await req.user.updateStats({
      totalListings: Math.max(0, req.user.statistics.totalListings - 1)
    });

    // Emit socket event
    req.io.to(req.user._id.toString()).emit('item-deleted', {
      itemId: item._id
    });

    res.json({
      message: 'Item deleted successfully'
    });

  } catch (error) {
    console.error('Delete item error:', error);
    res.status(500).json({
      error: 'Server error while deleting item'
    });
  }
});

// @route   POST /api/items/:id/images/:imageId/delete
// @desc    Delete specific image from item
// @access  Private
router.post('/:id/images/:imageId/delete', async (req, res) => {
  try {
    const item = await Item.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isActive: true
    });

    if (!item) {
      return res.status(404).json({
        error: 'Item not found'
      });
    }

    const imageIndex = item.images.findIndex(img => img._id.toString() === req.params.imageId);
    
    if (imageIndex === -1) {
      return res.status(404).json({
        error: 'Image not found'
      });
    }

    const image = item.images[imageIndex];

    // Delete from Cloudinary
    if (image.cloudinaryId) {
      try {
        await cloudinary.uploader.destroy(image.cloudinaryId);
      } catch (cloudinaryError) {
        console.error('Cloudinary delete error:', cloudinaryError);
      }
    }

    // Remove from array
    item.images.splice(imageIndex, 1);

    // If deleted image was primary, make first image primary
    if (image.isPrimary && item.images.length > 0) {
      item.images[0].isPrimary = true;
    }

    await item.save();

    res.json({
      message: 'Image deleted successfully',
      item
    });

  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({
      error: 'Server error while deleting image'
    });
  }
});

// @route   POST /api/items/:id/images/:imageId/primary
// @desc    Set image as primary
// @access  Private
router.post('/:id/images/:imageId/primary', async (req, res) => {
  try {
    const item = await Item.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isActive: true
    });

    if (!item) {
      return res.status(404).json({
        error: 'Item not found'
      });
    }

    const imageIndex = item.images.findIndex(img => img._id.toString() === req.params.imageId);
    
    if (imageIndex === -1) {
      return res.status(404).json({
        error: 'Image not found'
      });
    }

    // Reset all images to not primary
    item.images.forEach(img => {
      img.isPrimary = false;
    });

    // Set selected image as primary
    item.images[imageIndex].isPrimary = true;

    await item.save();

    res.json({
      message: 'Primary image updated successfully',
      item
    });

  } catch (error) {
    console.error('Set primary image error:', error);
    res.status(500).json({
      error: 'Server error while setting primary image'
    });
  }
});

// @route   POST /api/items/:id/duplicate
// @desc    Duplicate item
// @access  Private
router.post('/:id/duplicate', async (req, res) => {
  try {
    // Check subscription limits
    if (!req.user.canCreateListing()) {
      return res.status(403).json({
        error: 'Subscription limit reached. Please upgrade your plan.'
      });
    }

    const originalItem = await Item.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isActive: true
    });

    if (!originalItem) {
      return res.status(404).json({
        error: 'Item not found'
      });
    }

    // Create duplicate
    const duplicateData = originalItem.toObject();
    delete duplicateData._id;
    delete duplicateData.createdAt;
    delete duplicateData.updatedAt;
    delete duplicateData.__v;

    // Reset platform-specific data
    duplicateData.platforms.ebay.listingId = null;
    duplicateData.platforms.ebay.offerId = null;
    duplicateData.platforms.ebay.status = 'draft';
    duplicateData.platforms.willhaben.listingId = null;
    duplicateData.platforms.willhaben.adId = null;
    duplicateData.platforms.willhaben.status = 'draft';

    // Reset analytics
    duplicateData.analytics = {
      totalViews: 0,
      totalInquiries: 0,
      conversionRate: 0,
      priceHistory: [],
      performanceScore: 0
    };

    // Update title to indicate it's a copy
    duplicateData.title = duplicateData.title + ' (Copy)';
    duplicateData.status = 'draft';

    const duplicateItem = new Item(duplicateData);
    await duplicateItem.save();

    // Update user statistics
    await req.user.updateStats({
      totalListings: req.user.statistics.totalListings + 1
    });

    res.status(201).json({
      message: 'Item duplicated successfully',
      item: duplicateItem
    });

  } catch (error) {
    console.error('Duplicate item error:', error);
    res.status(500).json({
      error: 'Server error while duplicating item'
    });
  }
});

// @route   GET /api/items/search
// @desc    Search items
// @access  Private
router.get('/search', [
  query('q')
    .notEmpty()
    .trim()
    .withMessage('Search query is required'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
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

    const { q, page = 1, limit = 20 } = req.query;

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Search query
    const searchQuery = {
      userId: req.user._id,
      isActive: true,
      $text: { $search: q }
    };

    // Execute search
    const items = await Item.find(searchQuery)
      .sort({ score: { $meta: 'textScore' } })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count
    const total = await Item.countDocuments(searchQuery);

    res.json({
      items,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      query: q
    });

  } catch (error) {
    console.error('Search items error:', error);
    res.status(500).json({
      error: 'Server error while searching items'
    });
  }
});

// @route   GET /api/items/dashboard
// @desc    Get dashboard statistics
// @access  Private
router.get('/dashboard', async (req, res) => {
  try {
    const userId = req.user._id;

    // Get counts by status
    const statusCounts = await Item.aggregate([
      { $match: { userId, isActive: true } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Get platform statistics
    const platformStats = await Item.aggregate([
      { $match: { userId, isActive: true } },
      {
        $group: {
          _id: null,
          ebayEnabled: { $sum: { $cond: ['$platforms.ebay.enabled', 1, 0] } },
          willhabenEnabled: { $sum: { $cond: ['$platforms.willhaben.enabled', 1, 0] } },
          totalViews: { $sum: '$analytics.totalViews' },
          totalInquiries: { $sum: '$analytics.totalInquiries' }
        }
      }
    ]);

    // Get recent items
    const recentItems = await Item.find({
      userId,
      isActive: true
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('title status createdAt price.amount platforms');

    // Get performance metrics
    const performanceMetrics = await Item.aggregate([
      { $match: { userId, isActive: true } },
      {
        $group: {
          _id: null,
          avgPrice: { $avg: '$price.amount' },
          totalValue: { $sum: '$price.amount' },
          avgViews: { $avg: '$analytics.totalViews' },
          avgPerformanceScore: { $avg: '$analytics.performanceScore' }
        }
      }
    ]);

    res.json({
      statusCounts: statusCounts.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      platformStats: platformStats[0] || {},
      recentItems,
      performanceMetrics: performanceMetrics[0] || {},
      user: {
        subscription: req.user.subscription,
        statistics: req.user.statistics
      }
    });

  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({
      error: 'Server error while fetching dashboard data'
    });
  }
});

module.exports = router;