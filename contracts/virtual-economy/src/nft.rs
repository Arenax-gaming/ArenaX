// NFT management utilities
use crate::error::VirtualEconomyError;
use crate::storage::*;
use soroban_sdk::{Address, BytesN, Env, String, Vec};

pub struct NFTManager;

impl NFTManager {
    /// Validate NFT metadata before minting
    pub fn validate_metadata(metadata: &NFTMetadata) -> Result<(), VirtualEconomyError> {
        if metadata.name.len() == 0 || metadata.name.len() > 100 {
            return Err(VirtualEconomyError::InvalidMetadata);
        }

        if metadata.description.len() > 1000 {
            return Err(VirtualEconomyError::InvalidMetadata);
        }

        if metadata.rarity == 0 || metadata.rarity > 5 {
            return Err(VirtualEconomyError::InvalidMetadata);
        }

        if metadata.royalty_bps > 2000 {
            return Err(VirtualEconomyError::RoyaltyTooHigh);
        }

        Ok(())
    }

    /// Calculate NFT rarity score based on attributes
    pub fn calculate_rarity_score(env: &Env, metadata: &NFTMetadata) -> u32 {
        let mut score = metadata.rarity * 20; // Base score from rarity level

        // Add bonus for number of attributes
        score += metadata.attributes.len() as u32 * 5;

        // Add bonus for special categories
        let legendary = String::from_str(env, "legendary");
        let epic = String::from_str(env, "epic");
        let rare = String::from_str(env, "rare");

        if metadata.category == legendary {
            score += 50;
        } else if metadata.category == epic {
            score += 30;
        } else if metadata.category == rare {
            score += 15;
        }

        score
    }

    /// Generate collection statistics
    pub fn get_collection_stats(env: &Env, collection_name: &String) -> CollectionStats {
        // This would iterate through all NFTs and calculate stats
        // For now, return placeholder
        CollectionStats {
            total_items: 0,
            unique_owners: 0,
            floor_price: 0,
            total_volume: 0,
        }
    }

    /// Batch transfer NFTs for efficiency
    pub fn batch_transfer_nfts(
        env: &Env,
        from: &Address,
        to: &Address,
        token_ids: Vec<BytesN<32>>,
    ) -> Result<(), VirtualEconomyError> {
        from.require_auth();

        for token_id in token_ids.iter() {
            // Verify ownership and transfer each NFT
            let owner: Address = env
                .storage()
                .persistent()
                .get(&DataKey::NFTOwner(token_id.clone()))
                .ok_or(VirtualEconomyError::TokenNotFound)?;

            if owner != *from {
                return Err(VirtualEconomyError::NotOwner);
            }

            // Update ownership
            env.storage()
                .persistent()
                .set(&DataKey::NFTOwner(token_id.clone()), to);
        }

        // Update ownership lists in batch
        Self::update_ownership_lists(env, from, to, &token_ids)?;

        Ok(())
    }

    fn update_ownership_lists(
        env: &Env,
        from: &Address,
        to: &Address,
        token_ids: &Vec<BytesN<32>>,
    ) -> Result<(), VirtualEconomyError> {
        // Get current lists
        let mut from_nfts: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::OwnedNFTs(from.clone()))
            .unwrap_or_else(|| Vec::new(env));

        let mut to_nfts: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::OwnedNFTs(to.clone()))
            .unwrap_or_else(|| Vec::new(env));

        // Remove from sender's list and add to receiver's list
        for token_id in token_ids.iter() {
            // Remove from sender
            let mut new_from_nfts: Vec<BytesN<32>> = Vec::new(env);
            for nft in from_nfts.iter() {
                if nft != token_id {
                    new_from_nfts.push_back(nft);
                }
            }
            from_nfts = new_from_nfts;

            // Add to receiver
            to_nfts.push_back(token_id.clone());
        }

        // Update storage
        env.storage()
            .persistent()
            .set(&DataKey::OwnedNFTs(from.clone()), &from_nfts);
        env.storage()
            .persistent()
            .set(&DataKey::OwnedNFTs(to.clone()), &to_nfts);

        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct CollectionStats {
    pub total_items: u32,
    pub unique_owners: u32,
    pub floor_price: i128,
    pub total_volume: i128,
}
