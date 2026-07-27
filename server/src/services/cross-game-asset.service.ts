import { logger } from './logger.service.js';

export interface AssetDefinition {
    assetId: string;
    kind: 'nft' | 'currency' | 'achievement' | 'cosmetic';
    rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
    name: string;
    compatibleGames: number[];
    maxSupply: number;
    currentSupply: number;
    isTransferable: boolean;
    isTradeable: boolean;
    createdAt: number;
}

export interface AssetBalance {
    owner: string;
    assetId: string;
    amount: number;
    nftSerial?: number;
    acquiredAt: number;
    sourceGameId: number;
    version: number;
}

export interface BridgeRequest {
    requestId: string;
    owner: string;
    assetId: string;
    amount: number;
    sourceChain: string;
    targetChain: string;
    sourceGameId: number;
    targetGameId: number;
    status: 'pending' | 'confirmed' | 'completed' | 'failed' | 'cancelled';
    createdAt: number;
    completedAt?: number;
}

export interface ChainConfig {
    chainId: string;
    chainName: string;
    bridgeContract: string;
    isActive: boolean;
    maxBridgeAmount: number;
    bridgeFeeBps: number;
    cooldownSecs: number;
}

export interface AssetAnalytics {
    totalAssetsRegistered: number;
    totalMinted: number;
    totalTransferred: number;
    totalBridged: number;
    activeBridgeRequests: number;
    bridgeVolumeByChain: Record<string, number>;
    assetSupplyByType: Record<string, number>;
    topAssetsByVolume: Array<{ assetId: string; volume: number }>;
}

export class CrossGameAssetService {
    private assets: Map<string, AssetDefinition> = new Map();
    private balances: Map<string, AssetBalance> = new Map();
    private bridgeRequests: Map<string, BridgeRequest> = new Map();
    private chains: Map<string, ChainConfig> = new Map();
    private userLocks: Map<string, Promise<unknown>> = new Map();

    private async withUserLock<T>(userId: string, fn: () => T | Promise<T>): Promise<T> {
        const existingLock = this.userLocks.get(userId) || Promise.resolve();
        let resolveNext: () => void;
        const nextLock = new Promise<void>((resolve) => {
            resolveNext = resolve;
        });

        this.userLocks.set(userId, nextLock);

        try {
            await existingLock;
            return await fn();
        } finally {
            resolveNext!();
            if (this.userLocks.get(userId) === nextLock) {
                this.userLocks.delete(userId);
            }
        }
    }

    registerAsset(asset: AssetDefinition): void {
        this.assets.set(asset.assetId, asset);
        logger.info('Asset registered', { assetId: asset.assetId, name: asset.name });
    }

    getAsset(assetId: string): AssetDefinition | undefined {
        return this.assets.get(assetId);
    }

    getAllAssets(): AssetDefinition[] {
        return Array.from(this.assets.values());
    }

    mintAsset(
        assetId: string,
        to: string,
        amount: number,
        sourceGameId: number
    ): AssetBalance | null {
        const asset = this.assets.get(assetId);
        if (!asset) {
            logger.warn('Asset not found for minting', { assetId });
            return null;
        }

        if (asset.maxSupply > 0 && asset.currentSupply + amount > asset.maxSupply) {
            logger.warn('Max supply exceeded', { assetId, current: asset.currentSupply, max: asset.maxSupply });
            return null;
        }

        if (!asset.compatibleGames.includes(sourceGameId)) {
            logger.warn('Game not compatible', { assetId, sourceGameId });
            return null;
        }

        asset.currentSupply += amount;

        const key = `${to}:${assetId}`;
        const existing = this.balances.get(key);
        if (existing) {
            existing.amount += amount;
            existing.version = (existing.version || 1) + 1;
        } else {
            this.balances.set(key, {
                owner: to,
                assetId,
                amount,
                acquiredAt: Date.now(),
                sourceGameId,
                version: 1,
            });
        }

        return this.balances.get(key)!;
    }

    transferAsset(
        from: string,
        to: string,
        assetId: string,
        amount: number,
        fromGameId: number,
        toGameId: number
    ): boolean {
        const asset = this.assets.get(assetId);
        if (!asset || !asset.isTransferable) {
            return false;
        }

        if (!asset.compatibleGames.includes(toGameId)) {
            return false;
        }

        const fromKey = `${from}:${assetId}`;
        const fromBalance = this.balances.get(fromKey);
        if (!fromBalance || fromBalance.amount < amount) {
            return false;
        }

        fromBalance.amount -= amount;
        fromBalance.version = (fromBalance.version || 1) + 1;

        if (fromBalance.amount === 0) {
            this.balances.delete(fromKey);
        }

        const toKey = `${to}:${assetId}`;
        const toBalance = this.balances.get(toKey);
        if (toBalance) {
            toBalance.amount += amount;
            toBalance.version = (toBalance.version || 1) + 1;
        } else {
            this.balances.set(toKey, {
                owner: to,
                assetId,
                amount,
                acquiredAt: Date.now(),
                sourceGameId: fromGameId,
                version: 1,
            });
        }

        return true;
    }

    async transferAssetSync(
        from: string,
        to: string,
        assetId: string,
        amount: number,
        fromGameId: number,
        toGameId: number
    ): Promise<boolean> {
        return this.withUserLock(from, () =>
            this.transferAsset(from, to, assetId, amount, fromGameId, toGameId)
        );
    }

    initiateBridge(
        owner: string,
        assetId: string,
        amount: number,
        targetChain: string,
        sourceGameId: number,
        targetGameId: number
    ): BridgeRequest | null {
        const asset = this.assets.get(assetId);
        if (!asset || !asset.isTransferable) {
            return null;
        }

        const chain = this.chains.get(targetChain);
        if (!chain || !chain.isActive) {
            return null;
        }

        if (chain.maxBridgeAmount > 0 && amount > chain.maxBridgeAmount) {
            return null;
        }

        const key = `${owner}:${assetId}`;
        const balance = this.balances.get(key);
        if (!balance || balance.amount < amount) {
            return null;
        }

        // Lock assets
        balance.amount -= amount;
        balance.version = (balance.version || 1) + 1;
        if (balance.amount === 0) {
            this.balances.delete(key);
        }

        const requestId = `bridge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const request: BridgeRequest = {
            requestId,
            owner,
            assetId,
            amount,
            sourceChain: 'stellar',
            targetChain,
            sourceGameId,
            targetGameId,
            status: 'pending',
            createdAt: Date.now(),
        };

        this.bridgeRequests.set(requestId, request);

        logger.info('Bridge request initiated', { requestId, owner, assetId, targetChain });
        return request;
    }

    completeBridge(requestId: string): boolean {
        const request = this.bridgeRequests.get(requestId);
        if (!request || request.status !== 'pending') {
            return false;
        }

        request.status = 'completed';
        request.completedAt = Date.now();
        logger.info('Bridge completed', { requestId });
        return true;
    }

    failBridge(requestId: string): boolean {
        const request = this.bridgeRequests.get(requestId);
        if (!request || request.status !== 'pending') {
            return false;
        }

        // Refund locked assets
        const key = `${request.owner}:${request.assetId}`;
        const balance = this.balances.get(key);
        if (balance) {
            balance.amount += request.amount;
            balance.version = (balance.version || 1) + 1;
        } else {
            this.balances.set(key, {
                owner: request.owner,
                assetId: request.assetId,
                amount: request.amount,
                acquiredAt: Date.now(),
                sourceGameId: request.sourceGameId,
                version: 1,
            });
        }

        request.status = 'failed';
        request.completedAt = Date.now();
        logger.info('Bridge failed and refunded', { requestId });
        return true;
    }

    cancelBridge(requestId: string, ownerId: string): boolean {
        const request = this.bridgeRequests.get(requestId);
        if (!request || request.owner !== ownerId || request.status !== 'pending') {
            return false;
        }

        // Refund locked assets
        const key = `${request.owner}:${request.assetId}`;
        const balance = this.balances.get(key);
        if (balance) {
            balance.amount += request.amount;
            balance.version = (balance.version || 1) + 1;
        } else {
            this.balances.set(key, {
                owner: request.owner,
                assetId: request.assetId,
                amount: request.amount,
                acquiredAt: Date.now(),
                sourceGameId: request.sourceGameId,
                version: 1,
            });
        }

        request.status = 'cancelled';
        request.completedAt = Date.now();
        return true;
    }

    registerChain(chain: ChainConfig): void {
        this.chains.set(chain.chainId, chain);
        logger.info('Chain registered', { chainId: chain.chainId, name: chain.chainName });
    }

    getChain(chainId: string): ChainConfig | undefined {
        return this.chains.get(chainId);
    }

    getSupportedChains(): ChainConfig[] {
        return Array.from(this.chains.values()).filter((c) => c.isActive);
    }

    getPlayerInventory(player: string): AssetBalance[] {
        return Array.from(this.balances.values()).filter((b) => b.owner === player);
    }

    getAnalytics(): AssetAnalytics {
        const allAssets = Array.from(this.assets.values());
        const allBridges = Array.from(this.bridgeRequests.values());

        const bridgeVolumeByChain: Record<string, number> = {};
        for (const bridge of allBridges) {
            if (bridge.status === 'completed') {
                bridgeVolumeByChain[bridge.targetChain] =
                    (bridgeVolumeByChain[bridge.targetChain] || 0) + bridge.amount;
            }
        }

        const assetSupplyByType: Record<string, number> = {};
        for (const asset of allAssets) {
            assetSupplyByType[asset.kind] =
                (assetSupplyByType[asset.kind] || 0) + asset.currentSupply;
        }

        return {
            totalAssetsRegistered: allAssets.length,
            totalMinted: allAssets.reduce((sum, a) => sum + a.currentSupply, 0),
            totalTransferred: allBridges.filter((b) => b.status === 'completed').length,
            totalBridged: allBridges.filter((b) => b.status === 'completed').length,
            activeBridgeRequests: allBridges.filter((b) => b.status === 'pending').length,
            bridgeVolumeByChain,
            assetSupplyByType,
            topAssetsByVolume: allAssets
                .sort((a, b) => b.currentSupply - a.currentSupply)
                .slice(0, 10)
                .map((a) => ({ assetId: a.assetId, volume: a.currentSupply })),
        };
    }
}

export const defaultCrossGameAssetService = new CrossGameAssetService();
