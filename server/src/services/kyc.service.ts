import prisma from './database.service';
import { KycStatus, Prisma } from '@prisma/client';

export class KycService {
    async listReviews(query: { status?: KycStatus; limit?: number; offset?: number }) {
        const { status, limit = 20, offset = 0 } = query;
        
        const where: Prisma.KycReviewWhereInput = {};
        if (status) {
            where.status = status;
        }

        const reviews = await prisma.kycReview.findMany({
            where,
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        email: true,
                        role: true,
                        createdAt: true
                    }
                },
                reviewer: {
                    select: {
                        id: true,
                        username: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: Number(limit),
            skip: Number(offset)
        });

        const total = await prisma.kycReview.count({ where });

        return {
            reviews,
            pagination: {
                total,
                limit,
                offset
            }
        };
    }

    async getReview(id: string) {
        const review = await prisma.kycReview.findUnique({
            where: { id },
            include: {
                user: true,
                reviewer: {
                    select: {
                        id: true,
                        username: true
                    }
                }
            }
        });

        if (!review) {
            throw new Error('KYC review not found');
        }

        return review;
    }

    async processReview(id: string, reviewerId: string, data: { status: KycStatus; notes?: string }) {
        const { status, notes } = data;

        const review = await prisma.kycReview.findUnique({
            where: { id }
        });

        if (!review) {
            throw new Error('KYC review not found');
        }

        // Update the review
        const updatedReview = await prisma.kycReview.update({
            where: { id },
            data: {
                status,
                notes,
                reviewerId,
                resolvedAt: status === KycStatus.APPROVED || status === KycStatus.REJECTED ? new Date() : undefined,
                updatedAt: new Date()
            }
        });

        // If approved, update user's verification status
        if (status === KycStatus.APPROVED) {
            await prisma.user.update({
                where: { id: review.userId },
                data: {
                    isVerified: true
                }
            });
        }

        return updatedReview;
    }

    async createReview(userId: string, documents: any) {
        return prisma.kycReview.create({
            data: {
                userId,
                documents,
                status: KycStatus.PENDING
            }
        });
    }
}
