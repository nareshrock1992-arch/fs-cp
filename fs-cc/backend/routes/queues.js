import { Router } from 'express';
import * as queues from '../controllers/queuesController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(queues.listQueues));
router.get('/:queueName', asyncHandler(queues.getQueue));
router.post('/', asyncHandler(queues.createQueue));
router.put('/:queueName', asyncHandler(queues.updateQueue));
router.delete('/:queueName', asyncHandler(queues.deleteQueue));
router.post('/:queueName/tiers', asyncHandler(queues.addTier));
router.delete('/:queueName/tiers/:agentId', asyncHandler(queues.removeTier));

export default router;
