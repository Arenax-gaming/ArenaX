import nodemailer from 'nodemailer';

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private fromAddress: string;

  constructor() {
    this.fromAddress = process.env.EMAIL_FROM || 'noreply@arenax.gg';
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    const config: EmailConfig = {
      host: process.env.EMAIL_HOST || 'localhost',
      port: parseInt(process.env.EMAIL_PORT || '587', 10),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER || '',
        pass: process.env.EMAIL_PASSWORD || ''
      }
    };

    this.transporter = nodemailer.createTransport(config);
  }

  private async sendEmail(to: string, template: EmailTemplate): Promise<void> {
    if (!this.transporter) {
      throw new Error('Email transporter not initialized');
    }

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to,
        subject: template.subject,
        html: template.html,
        text: template.text
      });
    } catch (error) {
      console.error('Failed to send email:', error);
      throw error;
    }
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
    
    const template: EmailTemplate = {
      subject: 'Verify your ArenaX account',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verify your ArenaX account</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #6366f1;">Welcome to ArenaX!</h2>
            <p>Thank you for registering with ArenaX. Please verify your email address to complete your registration.</p>
            <p>This verification link will expire in 24 hours.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verificationUrl}" 
                 style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Verify Email
              </a>
            </div>
            <p>If you didn't create an account with ArenaX, you can safely ignore this email.</p>
            <p style="font-size: 12px; color: #666;">
              If the button doesn't work, copy and paste this link into your browser:<br>
              <a href="${verificationUrl}" style="color: #6366f1;">${verificationUrl}</a>
            </p>
          </div>
        </body>
        </html>
      `,
      text: `
        Welcome to ArenaX!
        
        Thank you for registering with ArenaX. Please verify your email address to complete your registration.
        
        This verification link will expire in 24 hours.
        
        Verify your email: ${verificationUrl}
        
        If you didn't create an account with ArenaX, you can safely ignore this email.
      `
    };

    await this.sendEmail(email, template);
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    
    const template: EmailTemplate = {
      subject: 'Reset your ArenaX password',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Reset your ArenaX password</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #6366f1;">Password Reset Request</h2>
            <p>We received a request to reset your ArenaX password.</p>
            <p>This reset link will expire in 24 hours.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" 
                 style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Reset Password
              </a>
            </div>
            <p>If you didn't request a password reset, you can safely ignore this email.</p>
            <p style="font-size: 12px; color: #666;">
              If the button doesn't work, copy and paste this link into your browser:<br>
              <a href="${resetUrl}" style="color: #6366f1;">${resetUrl}</a>
            </p>
          </div>
        </body>
        </html>
      `,
      text: `
        Password Reset Request
        
        We received a request to reset your ArenaX password.
        
        This reset link will expire in 24 hours.
        
        Reset your password: ${resetUrl}
        
        If you didn't request a password reset, you can safely ignore this email.
      `
    };

    await this.sendEmail(email, template);
  }

  async sendWelcomeEmail(email: string, username: string): Promise<void> {
    const template: EmailTemplate = {
      subject: 'Welcome to ArenaX!',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to ArenaX</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #6366f1;">Welcome to ArenaX, ${username}!</h2>
            <p>Your account has been successfully created and verified.</p>
            <p>You can now:</p>
            <ul>
              <li>Participate in tournaments</li>
              <li>Compete in ranked matches</li>
              <li>Earn achievements</li>
              <li>Connect with other players</li>
            </ul>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL}" 
                 style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Get Started
              </a>
            </div>
            <p>Good luck and have fun!</p>
          </div>
        </body>
        </html>
      `,
      text: `
        Welcome to ArenaX, ${username}!
        
        Your account has been successfully created and verified.
        
        You can now:
        - Participate in tournaments
        - Compete in ranked matches
        - Earn achievements
        - Connect with other players
        
        Get started: ${process.env.FRONTEND_URL}
        
        Good luck and have fun!
      `
    };

    await this.sendEmail(email, template);
  }
}

export default new EmailService();
