const express = require('express');
const { body, validationResult } = require('express-validator');
const fs = require('fs');
const path = require('path');
const csvWriter = require('csv-writer');
const puppeteer = require('puppeteer');

const User = require('../models/User');
const Item = require('../models/Item');

const router = express.Router();

// willhaben category mapping
const WILLHABEN_CATEGORIES = {
  'electronics': {
    id: 'electronics',
    name: 'Elektronik',
    subcategories: {
      'smartphones': { id: 'smartphones', name: 'Smartphones' },
      'tablets': { id: 'tablets', name: 'Tablets' },
      'laptops': { id: 'laptops', name: 'Laptops' },
      'computers': { id: 'computers', name: 'Computer' },
      'audio': { id: 'audio', name: 'Audio & HiFi' },
      'cameras': { id: 'cameras', name: 'Foto & Kameras' },
      'gaming': { id: 'gaming', name: 'Gaming' },
      'accessories': { id: 'accessories', name: 'Zubehör' }
    }
  },
  'vehicles': {
    id: 'vehicles',
    name: 'Auto & Motor',
    subcategories: {
      'cars': { id: 'cars', name: 'Autos' },
      'motorcycles': { id: 'motorcycles', name: 'Motorräder' },
      'parts': { id: 'parts', name: 'Teile & Zubehör' },
      'bicycles': { id: 'bicycles', name: 'Fahrräder' }
    }
  },
  'home': {
    id: 'home',
    name: 'Haus & Garten',
    subcategories: {
      'furniture': { id: 'furniture', name: 'Möbel' },
      'appliances': { id: 'appliances', name: 'Haushaltsgeräte' },
      'decoration': { id: 'decoration', name: 'Dekoration' },
      'garden': { id: 'garden', name: 'Garten' },
      'tools': { id: 'tools', name: 'Werkzeug' }
    }
  },
  'fashion': {
    id: 'fashion',
    name: 'Mode & Accessoires',
    subcategories: {
      'clothing': { id: 'clothing', name: 'Kleidung' },
      'shoes': { id: 'shoes', name: 'Schuhe' },
      'bags': { id: 'bags', name: 'Taschen' },
      'jewelry': { id: 'jewelry', name: 'Schmuck' },
      'watches': { id: 'watches', name: 'Uhren' }
    }
  },
  'sports': {
    id: 'sports',
    name: 'Sport & Freizeit',
    subcategories: {
      'fitness': { id: 'fitness', name: 'Fitness' },
      'outdoor': { id: 'outdoor', name: 'Outdoor' },
      'winter': { id: 'winter', name: 'Wintersport' },
      'water': { id: 'water', name: 'Wassersport' },
      'team': { id: 'team', name: 'Teamsport' }
    }
  },
  'books': {
    id: 'books',
    name: 'Bücher & Medien',
    subcategories: {
      'books': { id: 'books', name: 'Bücher' },
      'movies': { id: 'movies', name: 'Filme & DVDs' },
      'music': { id: 'music', name: 'Musik & CDs' },
      'games': { id: 'games', name: 'Spiele' }
    }
  },
  'toys': {
    id: 'toys',
    name: 'Spielzeug & Baby',
    subcategories: {
      'toys': { id: 'toys', name: 'Spielzeug' },
      'baby': { id: 'baby', name: 'Baby & Kind' },
      'strollers': { id: 'strollers', name: 'Kinderwagen' },
      'clothes': { id: 'clothes', name: 'Kinderkleidung' }
    }
  },
  'pets': {
    id: 'pets',
    name: 'Tiere',
    subcategories: {
      'dogs': { id: 'dogs', name: 'Hunde' },
      'cats': { id: 'cats', name: 'Katzen' },
      'accessories': { id: 'accessories', name: 'Tierzubehör' },
      'other': { id: 'other', name: 'Sonstige Tiere' }
    }
  }
};

// Map item condition to willhaben condition
const mapConditionToWillhaben = (condition) => {
  const conditionMap = {
    'new': 'Neu',
    'like_new': 'Neuwertig',
    'very_good': 'Sehr gut',
    'good': 'Gut',
    'acceptable': 'Gebraucht',
    'for_parts': 'Defekt'
  };
  return conditionMap[condition] || 'Gebraucht';
};

// Format item data for willhaben
const formatItemForWillhaben = (item) => {
  return {
    title: item.title,
    description: item.description,
    price: item.price.amount,
    condition: mapConditionToWillhaben(item.condition),
    category: item.category.willhabenId || item.category.main,
    location: `${item.location.zipCode || ''} ${item.location.city || ''}`.trim(),
    brand: item.specifications.brand || '',
    model: item.specifications.model || '',
    color: item.specifications.color || '',
    size: item.specifications.size || '',
    images: item.images.map(img => img.url).join(', '),
    contactEmail: item.userId.email,
    contactPhone: item.userId.phone || '',
    negotiable: item.price.negotiable ? 'Ja' : 'Nein',
    shipping: item.shipping.domesticShipping ? 'Ja' : 'Nein',
    pickup: item.location.pickup.available ? 'Ja' : 'Nein'
  };
};

// @route   GET /api/willhaben/categories
// @desc    Get willhaben categories
// @access  Private
router.get('/categories', async (req, res) => {
  try {
    res.json({
      categories: WILLHABEN_CATEGORIES
    });
  } catch (error) {
    console.error('Get willhaben categories error:', error);
    res.status(500).json({
      error: 'Server error while fetching willhaben categories'
    });
  }
});

// @route   POST /api/willhaben/configure
// @desc    Configure willhaben settings
// @access  Private
router.post('/configure', [
  body('email')
    .isEmail()
    .withMessage('Valid email is required'),
  body('defaultCategory')
    .optional()
    .isString()
    .withMessage('Default category must be a string'),
  body('defaultLocation')
    .optional()
    .isString()
    .withMessage('Default location must be a string'),
  body('autoUpload')
    .optional()
    .isBoolean()
    .withMessage('Auto upload must be a boolean'),
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

    const { email, defaultCategory, defaultLocation, autoUpload } = req.body;

    // Update user's willhaben settings
    req.user.platformSettings.willhaben.email = email;
    req.user.platformSettings.willhaben.defaultCategory = defaultCategory || '';
    req.user.platformSettings.willhaben.defaultLocation = defaultLocation || '';
    req.user.platformSettings.willhaben.autoUpload = autoUpload || false;
    req.user.platformSettings.willhaben.isEnabled = true;

    await req.user.save();

    res.json({
      message: 'willhaben settings configured successfully',
      settings: req.user.platformSettings.willhaben
    });

  } catch (error) {
    console.error('Configure willhaben error:', error);
    res.status(500).json({
      error: 'Server error while configuring willhaben settings'
    });
  }
});

// @route   POST /api/willhaben/items/:id/prepare
// @desc    Prepare item for willhaben listing
// @access  Private
router.post('/items/:id/prepare', async (req, res) => {
  try {
    const item = await Item.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isActive: true
    }).populate('userId', 'email phone');

    if (!item) {
      return res.status(404).json({
        error: 'Item not found'
      });
    }

    // Format item for willhaben
    const willhabenData = formatItemForWillhaben(item);
    
    // Generate description with additional details
    const formattedDescription = `
${item.description}

${item.conditionDescription ? `\nZustand: ${item.conditionDescription}` : ''}

${item.specifications.brand ? `\nMarke: ${item.specifications.brand}` : ''}
${item.specifications.model ? `Modell: ${item.specifications.model}` : ''}
${item.specifications.color ? `Farbe: ${item.specifications.color}` : ''}
${item.specifications.size ? `Größe: ${item.specifications.size}` : ''}
${item.specifications.material ? `Material: ${item.specifications.material}` : ''}
${item.specifications.year ? `Jahr: ${item.specifications.year}` : ''}

${item.shipping.freeShipping ? '\n✓ Kostenloser Versand' : ''}
${item.location.pickup.available ? '\n✓ Abholung möglich' : ''}
${item.price.negotiable ? '\n✓ Verhandlungsbasis' : ''}

${item.notes.public ? `\n${item.notes.public}` : ''}
    `.trim();

    // Update item with willhaben data
    item.platforms.willhaben.enabled = true;
    item.platforms.willhaben.exportData = {
      ...willhabenData,
      formattedDescription
    };
    
    await item.syncToPlatform('willhaben', {
      success: true,
      prepared: true
    });

    res.json({
      message: 'Item prepared for willhaben successfully',
      willhabenData: {
        ...willhabenData,
        formattedDescription
      }
    });

  } catch (error) {
    console.error('Prepare willhaben item error:', error);
    res.status(500).json({
      error: 'Server error while preparing item for willhaben'
    });
  }
});

// @route   POST /api/willhaben/items/:id/export-csv
// @desc    Export single item to CSV for willhaben
// @access  Private
router.post('/items/:id/export-csv', async (req, res) => {
  try {
    const item = await Item.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isActive: true
    }).populate('userId', 'email phone');

    if (!item) {
      return res.status(404).json({
        error: 'Item not found'
      });
    }

    // Format item for willhaben
    const willhabenData = formatItemForWillhaben(item);
    
    // Create CSV file
    const csvFilePath = path.join(__dirname, '../exports', `willhaben_${item._id}_${Date.now()}.csv`);
    
    // Ensure exports directory exists
    const exportsDir = path.dirname(csvFilePath);
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }

    const csvWriterInstance = csvWriter.createObjectCsvWriter({
      path: csvFilePath,
      header: [
        { id: 'title', title: 'Titel' },
        { id: 'description', title: 'Beschreibung' },
        { id: 'price', title: 'Preis' },
        { id: 'condition', title: 'Zustand' },
        { id: 'category', title: 'Kategorie' },
        { id: 'location', title: 'Standort' },
        { id: 'brand', title: 'Marke' },
        { id: 'model', title: 'Modell' },
        { id: 'color', title: 'Farbe' },
        { id: 'size', title: 'Größe' },
        { id: 'images', title: 'Bilder' },
        { id: 'contactEmail', title: 'E-Mail' },
        { id: 'contactPhone', title: 'Telefon' },
        { id: 'negotiable', title: 'Verhandelbar' },
        { id: 'shipping', title: 'Versand' },
        { id: 'pickup', title: 'Abholung' }
      ]
    });

    await csvWriterInstance.writeRecords([willhabenData]);

    // Update item with export data
    item.platforms.willhaben.exportData = {
      csv: csvFilePath,
      lastExported: new Date()
    };
    
    await item.syncToPlatform('willhaben', {
      success: true,
      exported: true
    });

    res.json({
      message: 'CSV export created successfully',
      csvPath: csvFilePath,
      downloadUrl: `/api/willhaben/download/${path.basename(csvFilePath)}`
    });

  } catch (error) {
    console.error('Export willhaben CSV error:', error);
    res.status(500).json({
      error: 'Server error while exporting CSV'
    });
  }
});

// @route   POST /api/willhaben/export-bulk-csv
// @desc    Export multiple items to CSV for willhaben
// @access  Private
router.post('/export-bulk-csv', [
  body('itemIds')
    .isArray({ min: 1 })
    .withMessage('Item IDs array is required'),
  body('itemIds.*')
    .isMongoId()
    .withMessage('Invalid item ID'),
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

    const { itemIds } = req.body;

    // Find items
    const items = await Item.find({
      _id: { $in: itemIds },
      userId: req.user._id,
      isActive: true
    }).populate('userId', 'email phone');

    if (items.length === 0) {
      return res.status(404).json({
        error: 'No items found'
      });
    }

    // Format items for willhaben
    const willhabenData = items.map(item => formatItemForWillhaben(item));
    
    // Create CSV file
    const csvFilePath = path.join(__dirname, '../exports', `willhaben_bulk_${Date.now()}.csv`);
    
    // Ensure exports directory exists
    const exportsDir = path.dirname(csvFilePath);
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }

    const csvWriterInstance = csvWriter.createObjectCsvWriter({
      path: csvFilePath,
      header: [
        { id: 'title', title: 'Titel' },
        { id: 'description', title: 'Beschreibung' },
        { id: 'price', title: 'Preis' },
        { id: 'condition', title: 'Zustand' },
        { id: 'category', title: 'Kategorie' },
        { id: 'location', title: 'Standort' },
        { id: 'brand', title: 'Marke' },
        { id: 'model', title: 'Modell' },
        { id: 'color', title: 'Farbe' },
        { id: 'size', title: 'Größe' },
        { id: 'images', title: 'Bilder' },
        { id: 'contactEmail', title: 'E-Mail' },
        { id: 'contactPhone', title: 'Telefon' },
        { id: 'negotiable', title: 'Verhandelbar' },
        { id: 'shipping', title: 'Versand' },
        { id: 'pickup', title: 'Abholung' }
      ]
    });

    await csvWriterInstance.writeRecords(willhabenData);

    // Update items with export data
    const updatePromises = items.map(item => {
      item.platforms.willhaben.exportData = {
        csv: csvFilePath,
        lastExported: new Date()
      };
      return item.syncToPlatform('willhaben', {
        success: true,
        exported: true
      });
    });

    await Promise.all(updatePromises);

    res.json({
      message: 'Bulk CSV export created successfully',
      csvPath: csvFilePath,
      downloadUrl: `/api/willhaben/download/${path.basename(csvFilePath)}`,
      itemsCount: items.length
    });

  } catch (error) {
    console.error('Export bulk willhaben CSV error:', error);
    res.status(500).json({
      error: 'Server error while exporting bulk CSV'
    });
  }
});

// @route   GET /api/willhaben/download/:filename
// @desc    Download exported CSV file
// @access  Private
router.get('/download/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, '../exports', filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: 'File not found'
      });
    }

    // Check if file belongs to user (basic security check)
    if (!filename.includes(req.user._id.toString()) && !filename.includes('bulk')) {
      return res.status(403).json({
        error: 'Access denied'
      });
    }

    res.download(filePath, filename, (err) => {
      if (err) {
        console.error('Download error:', err);
        res.status(500).json({
          error: 'Error downloading file'
        });
      }
    });

  } catch (error) {
    console.error('Download file error:', error);
    res.status(500).json({
      error: 'Server error while downloading file'
    });
  }
});

// @route   POST /api/willhaben/items/:id/generate-listing-url
// @desc    Generate willhaben listing URL with pre-filled data
// @access  Private
router.post('/items/:id/generate-listing-url', async (req, res) => {
  try {
    const item = await Item.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isActive: true
    }).populate('userId', 'email phone');

    if (!item) {
      return res.status(404).json({
        error: 'Item not found'
      });
    }

    // Format item for willhaben
    const willhabenData = formatItemForWillhaben(item);
    
    // Generate willhaben URL with pre-filled parameters
    const baseUrl = 'https://www.willhaben.at/iad/object/new';
    const params = new URLSearchParams({
      'object[title]': willhabenData.title,
      'object[description]': willhabenData.description,
      'object[price]': willhabenData.price.toString(),
      'object[location]': willhabenData.location,
      'object[condition]': willhabenData.condition,
      'object[category]': willhabenData.category,
      'object[brand]': willhabenData.brand,
      'object[model]': willhabenData.model,
      'object[color]': willhabenData.color,
      'contact[email]': willhabenData.contactEmail,
      'contact[phone]': willhabenData.contactPhone
    });

    const listingUrl = `${baseUrl}?${params.toString()}`;

    res.json({
      message: 'Listing URL generated successfully',
      listingUrl,
      instructions: [
        '1. Klicken Sie auf den generierten Link',
        '2. Überprüfen Sie die vorausgefüllten Daten',
        '3. Laden Sie die Bilder hoch',
        '4. Wählen Sie die passende Kategorie aus',
        '5. Veröffentlichen Sie das Inserat'
      ]
    });

  } catch (error) {
    console.error('Generate listing URL error:', error);
    res.status(500).json({
      error: 'Server error while generating listing URL'
    });
  }
});

// @route   POST /api/willhaben/items/:id/mark-published
// @desc    Mark item as published on willhaben
// @access  Private
router.post('/items/:id/mark-published', [
  body('listingId')
    .optional()
    .isString()
    .withMessage('Listing ID must be a string'),
  body('adId')
    .optional()
    .isString()
    .withMessage('Ad ID must be a string'),
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

    const { listingId, adId } = req.body;

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

    // Update item with willhaben listing data
    item.platforms.willhaben.listingId = listingId || null;
    item.platforms.willhaben.adId = adId || null;
    item.platforms.willhaben.status = 'active';
    item.status = 'active';
    
    await item.syncToPlatform('willhaben', {
      success: true,
      listingId: listingId,
      adId: adId
    });

    // Update user statistics
    await req.user.updateStats({
      activeListings: req.user.statistics.activeListings + 1
    });

    res.json({
      message: 'Item marked as published on willhaben successfully',
      item: item.toObject()
    });

  } catch (error) {
    console.error('Mark published error:', error);
    res.status(500).json({
      error: 'Server error while marking item as published'
    });
  }
});

// @route   POST /api/willhaben/items/:id/mark-sold
// @desc    Mark item as sold on willhaben
// @access  Private
router.post('/items/:id/mark-sold', [
  body('salePrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Sale price must be a positive number'),
  body('buyerInfo')
    .optional()
    .isString()
    .withMessage('Buyer info must be a string'),
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

    const { salePrice, buyerInfo } = req.body;

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

    // Mark item as sold
    await item.markAsSold('willhaben', buyerInfo || 'Unknown', salePrice || item.price.amount);

    // Update user statistics
    await req.user.updateStats({
      activeListings: Math.max(0, req.user.statistics.activeListings - 1),
      totalSales: req.user.statistics.totalSales + 1,
      totalRevenue: req.user.statistics.totalRevenue + (salePrice || item.price.amount)
    });

    res.json({
      message: 'Item marked as sold on willhaben successfully',
      item: item.toObject()
    });

  } catch (error) {
    console.error('Mark sold error:', error);
    res.status(500).json({
      error: 'Server error while marking item as sold'
    });
  }
});

// @route   GET /api/willhaben/items/:id/analytics
// @desc    Get willhaben item analytics
// @access  Private
router.get('/items/:id/analytics', async (req, res) => {
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

    const analytics = {
      views: item.platforms.willhaben.views || 0,
      inquiries: item.platforms.willhaben.inquiries || 0,
      status: item.platforms.willhaben.status,
      lastSync: item.platforms.willhaben.lastSync,
      exportedAt: item.platforms.willhaben.exportData?.lastExported,
      listingId: item.platforms.willhaben.listingId,
      adId: item.platforms.willhaben.adId
    };

    res.json({
      analytics
    });

  } catch (error) {
    console.error('Get willhaben analytics error:', error);
    res.status(500).json({
      error: 'Server error while fetching willhaben analytics'
    });
  }
});

// @route   GET /api/willhaben/guide
// @desc    Get willhaben listing guide
// @access  Private
router.get('/guide', async (req, res) => {
  try {
    const guide = {
      title: 'Anleitung für willhaben Inserate',
      steps: [
        {
          step: 1,
          title: 'Artikel vorbereiten',
          description: 'Verwenden Sie die "Für willhaben vorbereiten" Funktion',
          details: [
            'Artikel auswählen',
            'Kategorie überprüfen',
            'Beschreibung anpassen',
            'Bilder optimieren'
          ]
        },
        {
          step: 2,
          title: 'Export erstellen',
          description: 'CSV-Datei generieren oder URL erstellen',
          details: [
            'CSV-Export für Bulk-Upload',
            'Direkter Link mit vorausgefüllten Daten',
            'Manuelle Eingabe-Hilfe'
          ]
        },
        {
          step: 3,
          title: 'Auf willhaben veröffentlichen',
          description: 'Inserat auf willhaben.at erstellen',
          details: [
            'Zu willhaben.at gehen',
            'Neues Inserat erstellen',
            'Daten eingeben/importieren',
            'Bilder hochladen',
            'Veröffentlichen'
          ]
        },
        {
          step: 4,
          title: 'Status aktualisieren',
          description: 'Inserat-Status in der App aktualisieren',
          details: [
            'Inserat-ID eingeben',
            'Status auf "Veröffentlicht" setzen',
            'Analytics verfolgen'
          ]
        }
      ],
      tips: [
        'Verwenden Sie aussagekräftige Titel',
        'Fügen Sie detaillierte Beschreibungen hinzu',
        'Hochwertige Bilder verwenden',
        'Faire Preise setzen',
        'Schnell auf Anfragen antworten',
        'Standort korrekt angeben'
      ],
      categoryMapping: WILLHABEN_CATEGORIES
    };

    res.json({ guide });

  } catch (error) {
    console.error('Get willhaben guide error:', error);
    res.status(500).json({
      error: 'Server error while fetching willhaben guide'
    });
  }
});

// @route   POST /api/willhaben/cleanup-exports
// @desc    Clean up old export files
// @access  Private
router.post('/cleanup-exports', async (req, res) => {
  try {
    const exportsDir = path.join(__dirname, '../exports');
    
    if (!fs.existsSync(exportsDir)) {
      return res.json({
        message: 'No exports directory found'
      });
    }

    const files = fs.readdirSync(exportsDir);
    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
    let deletedCount = 0;

    files.forEach(file => {
      const filePath = path.join(exportsDir, file);
      const stats = fs.statSync(filePath);
      
      if (stats.mtime.getTime() < cutoffTime) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    });

    res.json({
      message: `Cleaned up ${deletedCount} old export files`
    });

  } catch (error) {
    console.error('Cleanup exports error:', error);
    res.status(500).json({
      error: 'Server error while cleaning up exports'
    });
  }
});

module.exports = router;