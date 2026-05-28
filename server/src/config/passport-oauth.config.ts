import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as DiscordStrategy } from 'passport-discord';
import { Strategy as TwitchStrategy } from 'passport-twitch-new';
import { getDatabaseClient } from '../services/database.service';
import { HttpError } from '../utils/http-error';

export const configureOAuthStrategies = (): void => {
    // Google OAuth Strategy
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        passport.use(
            new GoogleStrategy(
                {
                    clientID: process.env.GOOGLE_CLIENT_ID,
                    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                    callbackURL: `${process.env.BACKEND_URL}/api/v1/auth/google/callback`,
                    scope: ['profile', 'email']
                },
                async (accessToken, refreshToken, profile, done) => {
                    try {
                        const prisma = getDatabaseClient();
                        
                        let user = await prisma.user.findFirst({
                            where: {
                                provider: 'GOOGLE',
                                providerId: profile.id
                            }
                        });

                        if (!user) {
                            // Check if user exists by email
                            user = await prisma.user.findUnique({
                                where: { email: profile.emails?.[0]?.value }
                            });

                            if (user) {
                                // Link existing account
                                user = await prisma.user.update({
                                    where: { id: user.id },
                                    data: {
                                        provider: 'GOOGLE',
                                        providerId: profile.id,
                                        isVerified: true
                                    }
                                });
                            } else {
                                // Create new user
                                user = await prisma.user.create({
                                    data: {
                                        email: profile.emails?.[0]?.value || `${profile.id}@google.local`,
                                        username: profile.displayName || `google_${profile.id}`,
                                        passwordHash: '',
                                        provider: 'GOOGLE',
                                        providerId: profile.id,
                                        isVerified: true
                                    }
                                });
                            }
                        }

                        return done(null, user);
                    } catch (error) {
                        return done(error as Error);
                    }
                }
            )
        );
    }

    // Discord OAuth Strategy
    if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
        passport.use(
            new DiscordStrategy(
                {
                    clientID: process.env.DISCORD_CLIENT_ID,
                    clientSecret: process.env.DISCORD_CLIENT_SECRET,
                    callbackURL: `${process.env.BACKEND_URL}/api/v1/auth/discord/callback`,
                    scope: ['identify', 'email']
                },
                async (accessToken, refreshToken, profile, done) => {
                    try {
                        const prisma = getDatabaseClient();
                        
                        let user = await prisma.user.findFirst({
                            where: {
                                provider: 'DISCORD',
                                providerId: profile.id
                            }
                        });

                        if (!user) {
                            // Check if user exists by email
                            user = await prisma.user.findUnique({
                                where: { email: profile.email }
                            });

                            if (user) {
                                // Link existing account
                                user = await prisma.user.update({
                                    where: { id: user.id },
                                    data: {
                                        provider: 'DISCORD',
                                        providerId: profile.id,
                                        isVerified: true
                                    }
                                });
                            } else {
                                // Create new user
                                user = await prisma.user.create({
                                    data: {
                                        email: profile.email || `${profile.id}@discord.local`,
                                        username: profile.global_name || profile.username || `discord_${profile.id}`,
                                        passwordHash: '',
                                        provider: 'DISCORD',
                                        providerId: profile.id,
                                        isVerified: true
                                    }
                                });
                            }
                        }

                        return done(null, user);
                    } catch (error) {
                        return done(error as Error);
                    }
                }
            )
        );
    }

    // Twitch OAuth Strategy
    if (process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET) {
        passport.use(
            new TwitchStrategy(
                {
                    clientID: process.env.TWITCH_CLIENT_ID,
                    clientSecret: process.env.TWITCH_CLIENT_SECRET,
                    callbackURL: `${process.env.BACKEND_URL}/api/v1/auth/twitch/callback`,
                    scope: ['user:read:email']
                },
                async (accessToken, refreshToken, profile, done) => {
                    try {
                        const prisma = getDatabaseClient();
                        
                        let user = await prisma.user.findFirst({
                            where: {
                                provider: 'TWITCH',
                                providerId: profile.id
                            }
                        });

                        if (!user) {
                            // Check if user exists by email
                            user = await prisma.user.findUnique({
                                where: { email: profile.email }
                            });

                            if (user) {
                                // Link existing account
                                user = await prisma.user.update({
                                    where: { id: user.id },
                                    data: {
                                        provider: 'TWITCH',
                                        providerId: profile.id,
                                        isVerified: true
                                    }
                                });
                            } else {
                                // Create new user
                                user = await prisma.user.create({
                                    data: {
                                        email: profile.email || `${profile.id}@twitch.local`,
                                        username: profile.display_name || profile.login || `twitch_${profile.id}`,
                                        passwordHash: '',
                                        provider: 'TWITCH',
                                        providerId: profile.id,
                                        isVerified: true
                                    }
                                });
                            }
                        }

                        return done(null, user);
                    } catch (error) {
                        return done(error as Error);
                    }
                }
            )
        );
    }
};
