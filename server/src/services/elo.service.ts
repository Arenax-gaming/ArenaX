export class EloService {
    private readonly K= 32;
    /** 
     * Calculate new ratings for two players
     * outcome: 1 = A wins, 0= B wins, 0.5 = draw
     */
    calculateRating(
        ratingA: number,
        ratingB: number,
        outcome: 1| 0 | 0.5
    ) {
        const expectedA = 
            1 / (1+ Math.pow(10, (ratingB - ratingA) /400));
        const expectedB = 
            1 / (1+ Math.pow(10, (ratingA - ratingB) /400));
        const scoreA = outcome;
        const scoreB = outcome === 0.5 ? 0.5 : outcome === 1 ? 0 : 1;
        const newRatingA = Math.round(
            ratingA + this.K * (scoreA - expectedA)
        );
        const newRatingB = Math.round(
            ratingB + this.K * (scoreB - expectedB)
        );

        return {
            newRatingA,
            newRatingB,
            deltaA: newRatingA - ratingA,
            deltaB: newRatingB - ratingB,
        };
        
    }
}