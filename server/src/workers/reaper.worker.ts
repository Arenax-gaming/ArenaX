import  { PrismaClient }  from "@prisma/client";

const prisma = new PrismaClient();

export class ReaperWorker {
    start() {
        console.log("Reaper worker started");

        setInterval(()=>{
            this.checkExpiredMatches();
        }, 60 * 60 *1000); // every 1 hour
    }
    private async checkExpiredMatches() {
        const cutoff = new Date(Date.now() - 24*60*60*1000);
        const expired = await prisma.match.findMany({
            where: {
                state: "ACTIVE",
                updatedAt: {
                    lt: cutoff,
                },
            },
        });
        for(const match of expired) {
            await prisma.match.update({
                where: {id: match.id},
                data: {
                    state: "FORFEIT",
                },
            });
            console.log(`Match ${match.id} auto-forefeited`);
        }
    }
}