import { Router } from 'express';
import { Database } from '../database/index.js';
import { CreateUserModelSchema, UpdateUserModelSchema } from '@deprecated-claude/shared';

export function customModelsRouter(db: Database): Router {
  const router = Router();

  // Get all custom models for the authenticated user
  router.get('/', async (req, res) => {
    try {
      const userId = (req as any).userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const models = await db.getUserModels(userId);
      res.json(models);
    } catch (error) {
      console.error('Error fetching custom models:', error);
      res.status(500).json({ error: 'Failed to fetch custom models' });
    }
  });

  // Get a specific custom model
  router.get('/:id', async (req, res) => {
    try {
      const userId = (req as any).userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const model = await db.getUserModel(req.params.id, userId);
      if (!model) {
        return res.status(404).json({ error: 'Model not found' });
      }

      res.json(model);
    } catch (error) {
      console.error('Error fetching custom model:', error);
      res.status(500).json({ error: 'Failed to fetch custom model' });
    }
  });

  // Create a new custom model
  router.post('/', async (req, res) => {
    try {
      const userId = (req as any).userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Validate request body
      const validationResult = CreateUserModelSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          error: 'Invalid model data', 
          details: validationResult.error.issues 
        });
      }

      const modelData = validationResult.data;

      // Validate custom endpoint URL if provided
      if (modelData.customEndpoint?.baseUrl) {
        const url = new URL(modelData.customEndpoint.baseUrl);
        
        // Security: Only allow localhost, 127.0.0.1, or HTTPS external URLs
        const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
        const isHttps = url.protocol === 'https:';
        
        if (!isLocalhost && !isHttps) {
          return res.status(400).json({ 
            error: 'Custom endpoints must use HTTPS for external URLs. Only localhost can use HTTP.' 
          });
        }

        // Block private IP ranges for production (except localhost)
        if (!isLocalhost) {
          const privateRanges = [
            /^10\./,
            /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
            /^192\.168\./,
            /^169\.254\./
          ];
          
          if (privateRanges.some(range => range.test(url.hostname))) {
            return res.status(400).json({ 
              error: 'Cannot use private IP addresses for custom endpoints' 
            });
          }
        }
      }

      const model = await db.createUserModel(userId, modelData);
      
      console.log(`Created custom model: ${model.id} for user ${userId}`);
      res.status(201).json(model);
    } catch (error) {
      console.error('Error creating custom model:', error);
      
      if (error instanceof Error && error.message.includes('Maximum number')) {
        return res.status(400).json({ error: error.message });
      }
      
      res.status(500).json({ error: 'Failed to create custom model' });
    }
  });

  // Update a custom model
  router.patch('/:id', async (req, res) => {
    try {
      const userId = (req as any).userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Validate request body
      const validationResult = UpdateUserModelSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          error: 'Invalid model data', 
          details: validationResult.error.issues 
        });
      }

      const updates = validationResult.data;

      // Validate custom endpoint URL if being updated
      if (updates.customEndpoint?.baseUrl) {
        const url = new URL(updates.customEndpoint.baseUrl);
        
        const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
        const isHttps = url.protocol === 'https:';
        
        if (!isLocalhost && !isHttps) {
          return res.status(400).json({ 
            error: 'Custom endpoints must use HTTPS for external URLs. Only localhost can use HTTP.' 
          });
        }

        if (!isLocalhost) {
          const privateRanges = [
            /^10\./,
            /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
            /^192\.168\./,
            /^169\.254\./
          ];
          
          if (privateRanges.some(range => range.test(url.hostname))) {
            return res.status(400).json({ 
              error: 'Cannot use private IP addresses for custom endpoints' 
            });
          }
        }
      }

      const model = await db.updateUserModel(req.params.id, userId, updates);
      if (!model) {
        return res.status(404).json({ error: 'Model not found' });
      }

      console.log(`Updated custom model: ${model.id}`);
      res.json(model);
    } catch (error) {
      console.error('Error updating custom model:', error);
      res.status(500).json({ error: 'Failed to update custom model' });
    }
  });

  // Delete a custom model
  router.delete('/:id', async (req, res) => {
    try {
      const userId = (req as any).userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const deleted = await db.deleteUserModel(req.params.id, userId);
      if (!deleted) {
        return res.status(404).json({ error: 'Model not found' });
      }

      console.log(`Deleted custom model: ${req.params.id}`);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting custom model:', error);
      res.status(500).json({ error: 'Failed to delete custom model' });
    }
  });

  // Test a custom model connection
  router.post('/:id/test', async (req, res) => {
    try {
      const userId = (req as any).userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const model = await db.getUserModel(req.params.id, userId);
      if (!model) {
        return res.status(404).json({ error: 'Model not found' });
      }

      console.log(`Testing custom model: ${model.displayName} (${model.provider})`);

      // Import the appropriate service
      if (model.provider === 'openrouter') {
        const { OpenRouterService } = await import('../services/openrouter.js');
        const { ApiKeyManager } = await import('../services/api-key-manager.js');
        
        const apiKeyManager = new ApiKeyManager(db);
        const selectedKey = await apiKeyManager.getApiKeyForRequest(userId, 'openrouter', model.id);
        
        if (!selectedKey) {
          return res.status(400).json({ 
            success: false,
            error: 'No OpenRouter API key configured. Please add an OpenRouter API key in Settings → API Keys.' 
          });
        }

        const service = new OpenRouterService(db, selectedKey.credentials.apiKey);
        
        // Make a minimal test request
        try {
          let testResponse = '';
          let receivedChunks = 0;
          
          await service.streamCompletion(
            model.providerModelId,
            [{
              id: 'test-msg',
              conversationId: 'test-conv',
              branches: [{ id: 'test-branch', content: 'Say "test successful" and nothing else.', role: 'user', createdAt: new Date() }],
              activeBranchId: 'test-branch',
              order: 0
            }],
            undefined,
            { temperature: 0.7, maxTokens: 256 },  // Higher limit - some models need room
            async (chunk: string, isComplete: boolean) => {
              testResponse += chunk;
              if (chunk) receivedChunks++;
            }
          );
          
          // Verify we actually got a response
          const trimmedResponse = testResponse.trim();
          if (!trimmedResponse) {
            console.warn(`[OpenRouter test] Connection succeeded but response was empty (${receivedChunks} chunks received)`);
            res.json({ 
              success: false, 
              error: 'Connection succeeded but model returned empty response. The model may be unavailable or rate-limited.',
              details: {
                chunksReceived: receivedChunks,
                modelId: model.providerModelId
              }
            });
          } else {
            console.log(`[OpenRouter test] Success: "${trimmedResponse.slice(0, 50)}..." (${receivedChunks} chunks)`);
            res.json({ 
              success: true, 
              message: 'Connection successful!',
              response: trimmedResponse.slice(0, 100)
            });
          }
        } catch (error: any) {
          console.error('OpenRouter test failed:', error);
          res.json({ 
            success: false, 
            error: error.message || 'Failed to connect to OpenRouter' 
          });
        }
      } else if (model.provider === 'openai-compatible') {
        const { OpenAICompatibleService } = await import('../services/openai-compatible.js');
        
        if (!model.customEndpoint?.baseUrl) {
          return res.status(400).json({ 
            success: false,
            error: 'No endpoint configured for this model' 
          });
        }

        const service = new OpenAICompatibleService(
          db,
          model.customEndpoint.apiKey || '',
          model.customEndpoint.baseUrl,
          undefined
        );
        
        try {
          let testResponse = '';
          let receivedChunks = 0;
          
          await service.streamCompletion(
            model.providerModelId,
            [{
              id: 'test-msg',
              conversationId: 'test-conv',
              branches: [{ id: 'test-branch', content: 'Say "test successful" and nothing else.', role: 'user', createdAt: new Date() }],
              activeBranchId: 'test-branch',
              order: 0
            }],
            undefined,
            { temperature: 0.7, maxTokens: 256 },  // Higher limit - some models need room
            async (chunk: string, isComplete: boolean) => {
              testResponse += chunk;
              if (chunk) receivedChunks++;
            }
          );
          
          // Verify we actually got a response
          const trimmedResponse = testResponse.trim();
          if (!trimmedResponse) {
            console.warn(`[OpenAI-compatible test] Connection succeeded but response was empty (${receivedChunks} chunks received)`);
            res.json({ 
              success: false, 
              error: 'Connection succeeded but model returned empty response. Check that the model ID is correct and the model is loaded.',
              details: {
                chunksReceived: receivedChunks,
                endpoint: model.customEndpoint.baseUrl,
                modelId: model.providerModelId
              }
            });
          } else {
            console.log(`[OpenAI-compatible test] Success: "${trimmedResponse.slice(0, 50)}..." (${receivedChunks} chunks)`);
            res.json({ 
              success: true, 
              message: 'Connection successful!',
              response: trimmedResponse.slice(0, 100)
            });
          }
        } catch (error: any) {
          console.error('OpenAI-compatible test failed:', error);
          
          // Parse error for user-friendly messages
          const errorMsg = error.message || '';
          let friendlyError = errorMsg;
          let suggestion = '';
          
          if (errorMsg.includes('404')) {
            friendlyError = 'Endpoint not found (404)';
            suggestion = 'Check that the Base URL is correct. For Ollama, use http://localhost:11434. For LM Studio, use http://localhost:1234.';
          } else if (errorMsg.includes('401') || errorMsg.includes('403')) {
            friendlyError = 'Authentication failed';
            suggestion = 'Check that the API key is correct, or leave it empty if not required.';
          } else if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('fetch failed')) {
            friendlyError = 'Could not connect to server';
            suggestion = 'Make sure the server is running and the URL is reachable from the Arc backend.';
          } else if (errorMsg.includes('ENOTFOUND')) {
            friendlyError = 'Server address not found';
            suggestion = 'Check the hostname in your Base URL - it may be misspelled.';
          } else if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
            friendlyError = 'Connection timed out';
            suggestion = 'The server took too long to respond. It may be overloaded or unreachable.';
          } else if (errorMsg.includes('500')) {
            friendlyError = 'Server error (500)';
            suggestion = 'The server encountered an internal error. Check the model ID is correct.';
          }
          
          res.json({ 
            success: false, 
            error: friendlyError,
            suggestion: suggestion || undefined,
            details: {
              endpoint: model.customEndpoint?.baseUrl,
              modelId: model.providerModelId,
              rawError: errorMsg.slice(0, 200)  // Include raw error for debugging
            }
          });
        }
      } else {
        res.status(400).json({ 
          success: false,
          error: 'Unsupported provider for testing' 
        });
      }
    } catch (error) {
      console.error('Error testing custom model:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to test model connection' 
      });
    }
  });

  return router;
}

