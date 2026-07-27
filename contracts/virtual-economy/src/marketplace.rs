// Marketplace pricing engine.
//
// Pure, side-effect-free price calculations shared by the dynamic pricing
// contract methods in `lib.rs`: Dutch auctions (price falls over time until
// bought or expired) and bonding curve drops (mint price rises with units
// already minted). Kept separate from `lib.rs` so the math is easy to reason
// about and unit test in isolation from storage/auth concerns.

use crate::error::VirtualEconomyError;
use crate::storage::{BondingCurveDrop, DutchAuctionListing, PriceCurve};
use soroban_sdk::Env;

pub struct MarketplaceManager;

impl MarketplaceManager {
    /// Compute the current price of a Dutch auction listing given the
    /// current ledger time.
    ///
    /// * Before `start_time`: returns `start_price`.
    /// * After `end_time`: returns `floor_price`.
    /// * In between: decays from `start_price` to `floor_price` following
    ///   the listing's [`PriceCurve`].
    pub fn dutch_auction_price(env: &Env, listing: &DutchAuctionListing) -> i128 {
        let now = env.ledger().timestamp();
        if now <= listing.start_time {
            return listing.start_price;
        }
        if now >= listing.end_time {
            return listing.floor_price;
        }

        let elapsed = (now - listing.start_time) as i128;
        let duration = (listing.end_time - listing.start_time) as i128;
        let premium = listing.start_price - listing.floor_price;

        match listing.curve {
            PriceCurve::Linear => {
                let decayed = premium * elapsed / duration;
                listing.start_price - decayed
            }
            PriceCurve::Exponential => {
                // Approximate exponential decay without floating point:
                // halve the remaining premium every quarter of the auction
                // duration (4 halvings across the full duration).
                let steps = (elapsed * 4 / duration).min(4).max(0);
                let remaining_premium = premium >> steps;
                listing.floor_price + remaining_premium
            }
        }
    }

    /// Compute the current mint price of a bonding curve drop:
    /// `base_price + base_price * slope_bps * minted / 10_000`.
    pub fn bonding_curve_price(drop: &BondingCurveDrop) -> i128 {
        drop.base_price + (drop.base_price * drop.slope_bps as i128 * drop.minted as i128) / 10_000
    }

    /// Validate Dutch auction parameters before a listing is created.
    pub fn validate_auction_params(
        start_price: i128,
        floor_price: i128,
        start_time: u64,
        end_time: u64,
    ) -> Result<(), VirtualEconomyError> {
        if start_price <= 0 || floor_price <= 0 || floor_price > start_price {
            return Err(VirtualEconomyError::InvalidAuctionParams);
        }
        if end_time <= start_time {
            return Err(VirtualEconomyError::InvalidAuctionParams);
        }
        Ok(())
    }

    /// Validate bonding curve drop parameters before a drop is created.
    pub fn validate_curve_params(
        base_price: i128,
        slope_bps: u32,
        max_supply: Option<u32>,
    ) -> Result<(), VirtualEconomyError> {
        if base_price <= 0 {
            return Err(VirtualEconomyError::InvalidCurveParams);
        }
        if let Some(max) = max_supply {
            if max == 0 {
                return Err(VirtualEconomyError::InvalidCurveParams);
            }
        }
        let _ = slope_bps; // any non-negative slope is valid, including 0 (flat price)
        Ok(())
    }
}
