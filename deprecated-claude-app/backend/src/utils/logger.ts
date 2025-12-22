/**
 * Simple logger with category-based filtering
 * Control what gets logged via environment variables
 */

// Log categories that can be toggled
export const LogCategories = {
  CACHE: process.env.LOG_CACHE !== 'false',        // On by default - the interesting stuff
  CONTEXT: process.env.LOG_CONTEXT !== 'false',    // On by default - context rotation
  DEBUG: process.env.LOG_DEBUG === 'true',         // Off by default - noisy debug logs
  WEBSOCKET: process.env.LOG_WEBSOCKET === 'true', // Off by default - websocket details
  INFERENCE: process.env.LOG_INFERENCE === 'true', // Off by default - model selection
  ALL: process.env.LOG_ALL === 'true'              // Override to see everything
} as const;

export class Logger {
  static cache(...args: any[]) {
    if (LogCategories.ALL || LogCategories.CACHE) {
      console.log(...args);
    }
  }
  
  static context(...args: any[]) {
    if (LogCategories.ALL || LogCategories.CONTEXT) {
      console.log(...args);
    }
  }
  
  static debug(...args: any[]) {
    if (LogCategories.ALL || LogCategories.DEBUG) {
      console.log(...args);
    }
  }
  
  static websocket(...args: any[]) {
    if (LogCategories.ALL || LogCategories.WEBSOCKET) {
      console.log(...args);
    }
  }
  
  static inference(...args: any[]) {
    if (LogCategories.ALL || LogCategories.INFERENCE) {
      console.log(...args);
    }
  }
  
  static error(...args: any[]) {
    // Always log errors
    console.error(...args);
  }
  
  static warn(...args: any[]) {
    // Always log warnings
    console.warn(...args);
  }
  
  static info(...args: any[]) {
    // Always log important info
    console.log(...args);
  }
}

// Show current log settings on startup
if (process.env.NODE_ENV !== 'test') {
  console.log('📊 Log Settings:');
  console.log(`  Cache: ${LogCategories.CACHE ? '✅' : '❌'} (LOG_CACHE)`);
  console.log(`  Context: ${LogCategories.CONTEXT ? '✅' : '❌'} (LOG_CONTEXT)`);
  console.log(`  Debug: ${LogCategories.DEBUG ? '✅' : '❌'} (LOG_DEBUG)`);
  console.log(`  WebSocket: ${LogCategories.WEBSOCKET ? '✅' : '❌'} (LOG_WEBSOCKET)`);
  console.log(`  Inference: ${LogCategories.INFERENCE ? '✅' : '❌'} (LOG_INFERENCE)`);
  console.log('  To change: LOG_DEBUG=true LOG_WEBSOCKET=false npm run dev\n');
}
