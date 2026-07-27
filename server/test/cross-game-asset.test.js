import test from 'node:test'
import assert from 'node:assert'

test('CrossGameAssetService registers and retrieves an asset', async () => {
  const { CrossGameAssetService } = await import('../dist/services/cross-game-asset.service.js')
  const service = new CrossGameAssetService()
  service.registerAsset({
    assetId: 'asset-1', kind: 'nft', rarity: 'rare', name: 'Test NFT',
    compatibleGames: [1, 2, 3], maxSupply: 100, currentSupply: 0,
    isTransferable: true, isTradeable: true, createdAt: Date.now(),
  })
  const asset = service.getAsset('asset-1')
  assert.ok(asset)
  assert.strictEqual(asset.name, 'Test NFT')
  assert.strictEqual(asset.kind, 'nft')
})

test('CrossGameAssetService mints assets', async () => {
  const { CrossGameAssetService } = await import('../dist/services/cross-game-asset.service.js')
  const service = new CrossGameAssetService()
  service.registerAsset({
    assetId: 'asset-1', kind: 'currency', rarity: 'common', name: 'Gold',
    compatibleGames: [1], maxSupply: 0, currentSupply: 0,
    isTransferable: true, isTradeable: true, createdAt: Date.now(),
  })
  const balance = service.mintAsset('asset-1', 'player-1', 100, 1)
  assert.ok(balance)
  assert.strictEqual(balance.amount, 100)
  assert.strictEqual(balance.owner, 'player-1')
})

test('CrossGameAssetService does not mint to incompatible game', async () => {
  const { CrossGameAssetService } = await import('../dist/services/cross-game-asset.service.js')
  const service = new CrossGameAssetService()
  service.registerAsset({
    assetId: 'asset-1', kind: 'nft', rarity: 'common', name: 'Test',
    compatibleGames: [1], maxSupply: 0, currentSupply: 0,
    isTransferable: true, isTradeable: true, createdAt: Date.now(),
  })
  const balance = service.mintAsset('asset-1', 'player-1', 100, 2)
  assert.strictEqual(balance, null)
})

test('CrossGameAssetService respects max supply', async () => {
  const { CrossGameAssetService } = await import('../dist/services/cross-game-asset.service.js')
  const service = new CrossGameAssetService()
  service.registerAsset({
    assetId: 'asset-1', kind: 'nft', rarity: 'legendary', name: 'Unique',
    compatibleGames: [1], maxSupply: 10, currentSupply: 0,
    isTransferable: true, isTradeable: true, createdAt: Date.now(),
  })
  service.mintAsset('asset-1', 'player-1', 10, 1)
  const balance = service.mintAsset('asset-1', 'player-2', 1, 1)
  assert.strictEqual(balance, null)
})

test('CrossGameAssetService transfers assets between players', async () => {
  const { CrossGameAssetService } = await import('../dist/services/cross-game-asset.service.js')
  const service = new CrossGameAssetService()
  service.registerAsset({
    assetId: 'asset-1', kind: 'currency', rarity: 'common', name: 'Gold',
    compatibleGames: [1, 2], maxSupply: 0, currentSupply: 0,
    isTransferable: true, isTradeable: true, createdAt: Date.now(),
  })
  service.mintAsset('asset-1', 'player-1', 100, 1)
  const success = service.transferAsset('player-1', 'player-2', 'asset-1', 50, 1, 2)
  assert.ok(success)
  const inventory1 = service.getPlayerInventory('player-1')
  const inventory2 = service.getPlayerInventory('player-2')
  assert.strictEqual(inventory1[0].amount, 50)
  assert.strictEqual(inventory2[0].amount, 50)
})

test('CrossGameAssetService initiates and completes bridge', async () => {
  const { CrossGameAssetService } = await import('../dist/services/cross-game-asset.service.js')
  const service = new CrossGameAssetService()
  service.registerChain({
    chainId: 'ethereum', chainName: 'Ethereum', bridgeContract: '0x123',
    isActive: true, maxBridgeAmount: 1000, bridgeFeeBps: 50, cooldownSecs: 0,
  })
  service.registerAsset({
    assetId: 'asset-1', kind: 'nft', rarity: 'epic', name: 'Bridgeable NFT',
    compatibleGames: [1], maxSupply: 0, currentSupply: 0,
    isTransferable: true, isTradeable: true, createdAt: Date.now(),
  })
  service.mintAsset('asset-1', 'player-1', 5, 1)
  const request = service.initiateBridge('player-1', 'asset-1', 2, 'ethereum', 1, 100)
  assert.ok(request)
  assert.strictEqual(request.status, 'pending')
  assert.strictEqual(request.amount, 2)
  const inventory = service.getPlayerInventory('player-1')
  assert.strictEqual(inventory[0].amount, 3)
  const completed = service.completeBridge(request.requestId)
  assert.ok(completed)
})

test('CrossGameAssetService cancels bridge and refunds', async () => {
  const { CrossGameAssetService } = await import('../dist/services/cross-game-asset.service.js')
  const service = new CrossGameAssetService()
  service.registerChain({
    chainId: 'ethereum', chainName: 'Ethereum', bridgeContract: '0x123',
    isActive: true, maxBridgeAmount: 1000, bridgeFeeBps: 50, cooldownSecs: 0,
  })
  service.registerAsset({
    assetId: 'asset-1', kind: 'currency', rarity: 'common', name: 'Token',
    compatibleGames: [1], maxSupply: 0, currentSupply: 0,
    isTransferable: true, isTradeable: true, createdAt: Date.now(),
  })
  service.mintAsset('asset-1', 'player-1', 100, 1)
  const request = service.initiateBridge('player-1', 'asset-1', 50, 'ethereum', 1, 100)
  const cancelled = service.cancelBridge(request.requestId, 'player-1')
  assert.ok(cancelled)
  const inventory = service.getPlayerInventory('player-1')
  assert.strictEqual(inventory[0].amount, 100)
})

test('CrossGameAssetService returns analytics', async () => {
  const { CrossGameAssetService } = await import('../dist/services/cross-game-asset.service.js')
  const service = new CrossGameAssetService()
  service.registerAsset({
    assetId: 'asset-1', kind: 'nft', rarity: 'common', name: 'Test',
    compatibleGames: [1], maxSupply: 0, currentSupply: 0,
    isTransferable: true, isTradeable: true, createdAt: Date.now(),
  })
  service.mintAsset('asset-1', 'player-1', 10, 1)
  const analytics = service.getAnalytics()
  assert.strictEqual(analytics.totalAssetsRegistered, 1)
  assert.strictEqual(analytics.totalMinted, 10)
})

test('CrossGameAssetService handles rapid concurrent inventory transfers without race conditions (Issue #769)', async () => {
  const { CrossGameAssetService } = await import('../dist/services/cross-game-asset.service.js')
  const service = new CrossGameAssetService()
  service.registerAsset({
    assetId: 'asset-sync', kind: 'currency', rarity: 'common', name: 'Coins',
    compatibleGames: [1, 2], maxSupply: 0, currentSupply: 0,
    isTransferable: true, isTradeable: true, createdAt: Date.now(),
  })
  service.mintAsset('asset-sync', 'player-sync-1', 1000, 1)

  // Rapid simultaneous transfers
  const promises = Array.from({ length: 10 }).map(() =>
    service.transferAssetSync('player-sync-1', 'player-sync-2', 'asset-sync', 10, 1, 2)
  )
  const results = await Promise.all(promises)

  assert.strictEqual(results.every(Boolean), true)
  const inv1 = service.getPlayerInventory('player-sync-1')
  const inv2 = service.getPlayerInventory('player-sync-2')
  assert.strictEqual(inv1[0].amount, 900)
  assert.strictEqual(inv2[0].amount, 100)
  assert.strictEqual(inv1[0].version > 1, true)
})

