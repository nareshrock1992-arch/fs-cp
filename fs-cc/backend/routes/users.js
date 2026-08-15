import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as users from '../controllers/usersController.js';

const router = Router();

// All user-management endpoints require a valid JWT AND admin role
router.use(requireAuth, requireAdmin);

router.get('/',               asyncHandler(users.listUsers));
router.post('/',              asyncHandler(users.createUser));
router.put('/:id',            asyncHandler(users.updateUser));
router.delete('/:id',         asyncHandler(users.deleteUser));
router.post('/:id/reset-password', asyncHandler(users.resetPassword));
router.patch('/:id/permissions',   asyncHandler(users.updatePermissions));

export default router;
