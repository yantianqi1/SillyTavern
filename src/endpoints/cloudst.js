import express from 'express';

import {
    deleteCloudStUser,
    listCloudStUsers,
    requireCloudStSecret,
    toCloudStErrorPayload,
    upsertCloudStUser,
} from '../cloudst.js';

export const router = express.Router();

router.use(requireCloudStSecret);

router.post('/users/upsert', async (request, response) => {
    try {
        const result = await upsertCloudStUser(request.body?.user ?? request.body ?? {});
        return response.json({
            success: true,
            created: result.created,
            user: {
                handle: result.user.handle,
                name: result.user.name,
                enabled: result.user.enabled,
                admin: result.user.admin,
                created: result.user.created,
            },
        });
    } catch (error) {
        const payload = toCloudStErrorPayload(error);
        return response.status(payload.status).json(payload.body);
    }
});

router.post('/users/delete', async (request, response) => {
    try {
        await deleteCloudStUser(request.body ?? {});
        return response.json({ success: true });
    } catch (error) {
        const payload = toCloudStErrorPayload(error);
        return response.status(payload.status).json(payload.body);
    }
});

router.post('/users/list', async (_request, response) => {
    try {
        const users = await listCloudStUsers();
        return response.json({ success: true, users });
    } catch (error) {
        const payload = toCloudStErrorPayload(error);
        return response.status(payload.status).json(payload.body);
    }
});
