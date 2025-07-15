const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    // Get token from header
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ 
        error: 'No token provided. Access denied.' 
      });
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    // Check if user exists and is active
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user || !user.isActive) {
      return res.status(401).json({ 
        error: 'User not found or inactive. Access denied.' 
      });
    }
    
    // Check if user account is locked
    if (user.isLocked) {
      return res.status(423).json({ 
        error: 'Account is locked. Please try again later.' 
      });
    }
    
    // Add user to request object
    req.user = user;
    next();
    
  } catch (error) {
    console.error('Auth middleware error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Invalid token. Access denied.' 
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired. Please log in again.' 
      });
    }
    
    res.status(500).json({ 
      error: 'Server error during authentication.' 
    });
  }
};

module.exports = auth;