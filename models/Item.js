const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    maxlength: 5000
  },
  category: {
    main: {
      type: String,
      required: true
    },
    sub: String,
    ebayId: String,
    willhabenId: String
  },
  condition: {
    type: String,
    required: true,
    enum: ['new', 'like_new', 'very_good', 'good', 'acceptable', 'for_parts']
  },
  conditionDescription: {
    type: String,
    maxlength: 1000
  },
  price: {
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      default: 'EUR'
    },
    negotiable: {
      type: Boolean,
      default: false
    },
    originalPrice: Number,
    reservePrice: Number
  },
  images: [{
    url: {
      type: String,
      required: true
    },
    filename: String,
    size: Number,
    isPrimary: {
      type: Boolean,
      default: false
    },
    altText: String,
    cloudinaryId: String,
    order: {
      type: Number,
      default: 0
    }
  }],
  specifications: {
    brand: String,
    model: String,
    year: Number,
    color: String,
    size: String,
    material: String,
    weight: Number,
    dimensions: {
      length: Number,
      width: Number,
      height: Number,
      unit: {
        type: String,
        default: 'cm'
      }
    },
    custom: [{
      name: String,
      value: String
    }]
  },
  shipping: {
    weight: Number,
    dimensions: {
      length: Number,
      width: Number,
      height: Number,
      unit: {
        type: String,
        default: 'cm'
      }
    },
    shippingCost: Number,
    freeShipping: {
      type: Boolean,
      default: false
    },
    shippingMethods: [{
      type: String,
      enum: ['standard', 'express', 'overnight', 'pickup']
    }],
    handlingTime: {
      type: Number,
      default: 1 // days
    },
    domesticShipping: {
      type: Boolean,
      default: true
    },
    internationalShipping: {
      type: Boolean,
      default: false
    }
  },
  location: {
    city: String,
    state: String,
    country: {
      type: String,
      default: 'AT' // Austria
    },
    zipCode: String,
    coordinates: {
      lat: Number,
      lng: Number
    },
    pickup: {
      available: {
        type: Boolean,
        default: true
      },
      address: String,
      instructions: String
    }
  },
  availability: {
    quantity: {
      type: Number,
      default: 1,
      min: 0
    },
    reserved: {
      type: Number,
      default: 0
    },
    sold: {
      type: Number,
      default: 0
    },
    available: {
      type: Boolean,
      default: true
    },
    availableFrom: Date,
    availableUntil: Date
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: 50
  }],
  seo: {
    keywords: [String],
    metaDescription: String
  },
  platforms: {
    ebay: {
      enabled: {
        type: Boolean,
        default: false
      },
      listingId: String,
      offerId: String,
      sku: String,
      categoryId: String,
      status: {
        type: String,
        enum: ['draft', 'active', 'inactive', 'completed', 'sold', 'error'],
        default: 'draft'
      },
      listingFormat: {
        type: String,
        enum: ['FixedPrice', 'Auction', 'StoresFixedPrice'],
        default: 'FixedPrice'
      },
      duration: {
        type: String,
        enum: ['Days_1', 'Days_3', 'Days_5', 'Days_7', 'Days_10', 'Days_30', 'GTC'],
        default: 'GTC'
      },
      lastSync: Date,
      syncStatus: {
        type: String,
        enum: ['success', 'error', 'pending'],
        default: 'pending'
      },
      errorMessage: String,
      fees: {
        insertion: Number,
        final: Number,
        paypal: Number,
        total: Number
      },
      views: {
        type: Number,
        default: 0
      },
      watchers: {
        type: Number,
        default: 0
      },
      questions: {
        type: Number,
        default: 0
      }
    },
    willhaben: {
      enabled: {
        type: Boolean,
        default: false
      },
      listingId: String,
      adId: String,
      categoryId: String,
      status: {
        type: String,
        enum: ['draft', 'active', 'inactive', 'completed', 'sold', 'error'],
        default: 'draft'
      },
      lastSync: Date,
      syncStatus: {
        type: String,
        enum: ['success', 'error', 'pending'],
        default: 'pending'
      },
      errorMessage: String,
      views: {
        type: Number,
        default: 0
      },
      inquiries: {
        type: Number,
        default: 0
      },
      exportData: {
        csv: String,
        lastExported: Date
      }
    }
  },
  analytics: {
    totalViews: {
      type: Number,
      default: 0
    },
    totalInquiries: {
      type: Number,
      default: 0
    },
    conversionRate: {
      type: Number,
      default: 0
    },
    avgResponseTime: Number,
    priceHistory: [{
      price: Number,
      date: {
        type: Date,
        default: Date.now
      },
      platform: String
    }],
    performanceScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    }
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'sold', 'expired', 'deleted'],
    default: 'draft'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  notes: {
    internal: String,
    public: String
  },
  soldTo: {
    platform: {
      type: String,
      enum: ['ebay', 'willhaben']
    },
    buyerId: String,
    saleDate: Date,
    salePrice: Number,
    fees: Number,
    netProfit: Number
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  scheduledDate: Date,
  expirationDate: Date
}, {
  timestamps: true
});

// Indexes for better performance
itemSchema.index({ userId: 1 });
itemSchema.index({ status: 1 });
itemSchema.index({ 'platforms.ebay.status': 1 });
itemSchema.index({ 'platforms.willhaben.status': 1 });
itemSchema.index({ createdAt: -1 });
itemSchema.index({ 'category.main': 1 });
itemSchema.index({ 'price.amount': 1 });
itemSchema.index({ tags: 1 });

// Text search index
itemSchema.index({
  title: 'text',
  description: 'text',
  tags: 'text',
  'specifications.brand': 'text',
  'specifications.model': 'text'
});

// Virtual for available quantity
itemSchema.virtual('availableQuantity').get(function() {
  return this.availability.quantity - this.availability.reserved - this.availability.sold;
});

// Virtual for profit calculation
itemSchema.virtual('estimatedProfit').get(function() {
  const totalFees = (this.platforms.ebay.fees?.total || 0) + (this.shipping.shippingCost || 0);
  return this.price.amount - totalFees;
});

// Virtual for platform count
itemSchema.virtual('platformCount').get(function() {
  let count = 0;
  if (this.platforms.ebay.enabled) count++;
  if (this.platforms.willhaben.enabled) count++;
  return count;
});

// Virtual for primary image
itemSchema.virtual('primaryImage').get(function() {
  return this.images.find(img => img.isPrimary) || this.images[0];
});

// Method to update analytics
itemSchema.methods.updateAnalytics = function(platform, data) {
  if (platform === 'ebay') {
    this.platforms.ebay.views = data.views || this.platforms.ebay.views;
    this.platforms.ebay.watchers = data.watchers || this.platforms.ebay.watchers;
    this.platforms.ebay.questions = data.questions || this.platforms.ebay.questions;
  } else if (platform === 'willhaben') {
    this.platforms.willhaben.views = data.views || this.platforms.willhaben.views;
    this.platforms.willhaben.inquiries = data.inquiries || this.platforms.willhaben.inquiries;
  }
  
  this.analytics.totalViews = (this.platforms.ebay.views || 0) + (this.platforms.willhaben.views || 0);
  this.analytics.totalInquiries = (this.platforms.ebay.questions || 0) + (this.platforms.willhaben.inquiries || 0);
  
  return this.save();
};

// Method to mark as sold
itemSchema.methods.markAsSold = function(platform, buyerId, salePrice, fees = 0) {
  this.status = 'sold';
  this.soldTo = {
    platform,
    buyerId,
    saleDate: new Date(),
    salePrice,
    fees,
    netProfit: salePrice - fees
  };
  this.availability.sold = this.availability.quantity;
  this.availability.available = false;
  
  return this.save();
};

// Method to sync with platform
itemSchema.methods.syncToPlatform = async function(platform, data) {
  if (platform === 'ebay') {
    this.platforms.ebay.lastSync = new Date();
    this.platforms.ebay.syncStatus = data.success ? 'success' : 'error';
    if (data.success) {
      this.platforms.ebay.listingId = data.listingId;
      this.platforms.ebay.offerId = data.offerId;
      this.platforms.ebay.status = 'active';
    } else {
      this.platforms.ebay.errorMessage = data.error;
    }
  } else if (platform === 'willhaben') {
    this.platforms.willhaben.lastSync = new Date();
    this.platforms.willhaben.syncStatus = data.success ? 'success' : 'error';
    if (data.success) {
      this.platforms.willhaben.listingId = data.listingId;
      this.platforms.willhaben.adId = data.adId;
      this.platforms.willhaben.status = 'active';
    } else {
      this.platforms.willhaben.errorMessage = data.error;
    }
  }
  
  return this.save();
};

// Method to get active platforms
itemSchema.methods.getActivePlatforms = function() {
  const platforms = [];
  if (this.platforms.ebay.enabled) platforms.push('ebay');
  if (this.platforms.willhaben.enabled) platforms.push('willhaben');
  return platforms;
};

// Method to update price history
itemSchema.methods.updatePriceHistory = function(newPrice, platform) {
  this.analytics.priceHistory.push({
    price: newPrice,
    date: new Date(),
    platform
  });
  
  // Keep only last 50 price changes
  if (this.analytics.priceHistory.length > 50) {
    this.analytics.priceHistory = this.analytics.priceHistory.slice(-50);
  }
  
  return this.save();
};

// Static method to get items by status
itemSchema.statics.findByStatus = function(userId, status) {
  return this.find({ userId, status, isActive: true });
};

// Static method to get items by platform
itemSchema.statics.findByPlatform = function(userId, platform) {
  const query = { userId, isActive: true };
  query[`platforms.${platform}.enabled`] = true;
  return this.find(query);
};

module.exports = mongoose.model('Item', itemSchema);