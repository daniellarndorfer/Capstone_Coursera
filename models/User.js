const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 50
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    trim: true
  },
  address: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: String
  },
  platformSettings: {
    ebay: {
      isEnabled: {
        type: Boolean,
        default: false
      },
      sandbox: {
        type: Boolean,
        default: true
      },
      clientId: String,
      clientSecret: String,
      accessToken: String,
      refreshToken: String,
      tokenExpiry: Date,
      sellerAccount: String,
      paymentPolicyId: String,
      fulfillmentPolicyId: String,
      returnPolicyId: String,
      defaultCategory: String,
      defaultLocation: String
    },
    willhaben: {
      isEnabled: {
        type: Boolean,
        default: false
      },
      username: String,
      email: String,
      defaultCategory: String,
      defaultLocation: String,
      autoUpload: {
        type: Boolean,
        default: false
      }
    }
  },
  preferences: {
    currency: {
      type: String,
      default: 'EUR'
    },
    language: {
      type: String,
      default: 'en'
    },
    timezone: {
      type: String,
      default: 'Europe/Vienna'
    },
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      sms: {
        type: Boolean,
        default: false
      },
      push: {
        type: Boolean,
        default: true
      }
    },
    defaultPlatforms: [{
      type: String,
      enum: ['ebay', 'willhaben']
    }],
    autoSync: {
      type: Boolean,
      default: true
    },
    syncInterval: {
      type: Number,
      default: 60 // minutes
    }
  },
  subscription: {
    type: {
      type: String,
      enum: ['free', 'basic', 'premium', 'enterprise'],
      default: 'free'
    },
    startDate: {
      type: Date,
      default: Date.now
    },
    endDate: Date,
    isActive: {
      type: Boolean,
      default: true
    },
    limits: {
      maxItems: {
        type: Number,
        default: 10
      },
      maxImages: {
        type: Number,
        default: 3
      },
      maxPlatforms: {
        type: Number,
        default: 2
      }
    }
  },
  statistics: {
    totalListings: {
      type: Number,
      default: 0
    },
    activeListings: {
      type: Number,
      default: 0
    },
    totalSales: {
      type: Number,
      default: 0
    },
    totalRevenue: {
      type: Number,
      default: 0
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: String,
  passwordResetToken: String,
  passwordResetExpires: Date,
  lastLogin: Date,
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: Date
}, {
  timestamps: true
});

// Index for better performance
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ isActive: 1 });

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual for account lock status
userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to increment login attempts
userSchema.methods.incLoginAttempts = function() {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: {
        loginAttempts: 1
      },
      $unset: {
        lockUntil: 1
      }
    });
  }
  
  const updates = { $inc: { loginAttempts: 1 } };
  
  // Lock account after 5 failed attempts
  if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
    updates.$set = {
      lockUntil: Date.now() + (2 * 60 * 60 * 1000) // 2 hours
    };
  }
  
  return this.updateOne(updates);
};

// Method to reset login attempts
userSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $unset: {
      loginAttempts: 1,
      lockUntil: 1
    }
  });
};

// Method to check if eBay token is valid
userSchema.methods.isEbayTokenValid = function() {
  return this.platformSettings.ebay.accessToken && 
         this.platformSettings.ebay.tokenExpiry && 
         this.platformSettings.ebay.tokenExpiry > new Date();
};

// Method to get active platforms
userSchema.methods.getActivePlatforms = function() {
  const platforms = [];
  if (this.platformSettings.ebay.isEnabled) platforms.push('ebay');
  if (this.platformSettings.willhaben.isEnabled) platforms.push('willhaben');
  return platforms;
};

// Method to check subscription limits
userSchema.methods.canCreateListing = function() {
  return this.statistics.totalListings < this.subscription.limits.maxItems;
};

// Method to update statistics
userSchema.methods.updateStats = function(stats) {
  Object.assign(this.statistics, stats);
  return this.save();
};

module.exports = mongoose.model('User', userSchema);