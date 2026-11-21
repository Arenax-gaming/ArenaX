use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum NotificationChannel {
    Push,
    Email,
    InApp,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotificationTemplate {
    pub subject: Option<String>,
    pub body: String,
    pub plural_body: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderedNotification {
    pub subject: Option<String>,
    pub body: String,
}

#[derive(Debug, Clone)]
pub struct NotificationTemplateEngine {
    default_locale: String,
    /// Map of (template_key, channel, locale) -> NotificationTemplate
    templates: HashMap<(String, NotificationChannel, String), NotificationTemplate>,
}

impl NotificationTemplateEngine {
    pub fn new(default_locale: impl Into<String>) -> Self {
        Self {
            default_locale: default_locale.into(),
            templates: HashMap::new(),
        }
    }

    pub fn register_template(
        &mut self,
        template_key: impl Into<String>,
        channel: NotificationChannel,
        locale: impl Into<String>,
        template: NotificationTemplate,
    ) {
        self.templates.insert(
            (template_key.into(), channel, locale.into()),
            template,
        );
    }

    pub fn render(
        &self,
        template_key: &str,
        channel: NotificationChannel,
        locale: &str,
        vars: &HashMap<&str, String>,
        count: Option<usize>,
    ) -> Option<RenderedNotification> {
        let template = self
            .templates
            .get(&(template_key.to_string(), channel, locale.to_string()))
            .or_else(|| {
                self.templates.get(&(
                    template_key.to_string(),
                    channel,
                    self.default_locale.clone(),
                ))
            })?;

        let raw_body = match (count, &template.plural_body) {
            (Some(c), Some(plural)) if c != 1 => plural,
            _ => &template.body,
        };

        let rendered_body = substitute_placeholders(raw_body, vars);
        let rendered_subject = template
            .subject
            .as_ref()
            .map(|subj| substitute_placeholders(subj, vars));

        Some(RenderedNotification {
            subject: rendered_subject,
            body: rendered_body,
        })
    }
}

fn substitute_placeholders(template: &str, vars: &HashMap<&str, String>) -> String {
    let mut output = template.to_string();
    for (key, value) in vars {
        let placeholder = format!("{{{{{}}}}}", key);
        output = output.replace(&placeholder, value);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_same_template_in_two_locales() {
        let mut engine = NotificationTemplateEngine::new("en");

        engine.register_template(
            "tournament_start",
            NotificationChannel::Push,
            "en",
            NotificationTemplate {
                subject: None,
                body: "Match starting soon in {{tournament_name}}!".to_string(),
                plural_body: None,
            },
        );

        engine.register_template(
            "tournament_start",
            NotificationChannel::Push,
            "es",
            NotificationTemplate {
                subject: None,
                body: "¡El partido comenzará pronto en {{tournament_name}}!".to_string(),
                plural_body: None,
            },
        );

        let mut vars = HashMap::new();
        vars.insert("tournament_name", "ArenaX Cup".to_string());

        let en_out = engine
            .render("tournament_start", NotificationChannel::Push, "en", &vars, None)
            .unwrap();
        let es_out = engine
            .render("tournament_start", NotificationChannel::Push, "es", &vars, None)
            .unwrap();

        assert_eq!(en_out.body, "Match starting soon in ArenaX Cup!");
        assert_eq!(es_out.body, "¡El partido comenzará pronto en ArenaX Cup!");
        assert_ne!(en_out.body, es_out.body);
    }

    #[test]
    fn falls_back_to_default_locale_when_missing() {
        let mut engine = NotificationTemplateEngine::new("en");

        engine.register_template(
            "match_invite",
            NotificationChannel::Email,
            "en",
            NotificationTemplate {
                subject: Some("Invite to {{tournament_name}}".to_string()),
                body: "You have been invited to {{tournament_name}}.".to_string(),
                plural_body: None,
            },
        );

        let mut vars = HashMap::new();
        vars.insert("tournament_name", "Grand Finals".to_string());

        let fallback = engine
            .render("match_invite", NotificationChannel::Email, "fr", &vars, None)
            .unwrap();

        assert_eq!(fallback.subject.as_deref(), Some("Invite to Grand Finals"));
        assert_eq!(fallback.body, "You have been invited to Grand Finals.");
    }

    #[test]
    fn supports_pluralization() {
        let mut engine = NotificationTemplateEngine::new("en");

        engine.register_template(
            "pending_invites",
            NotificationChannel::InApp,
            "en",
            NotificationTemplate {
                subject: None,
                body: "You have {{count}} new invite.".to_string(),
                plural_body: Some("You have {{count}} new invites.".to_string()),
            },
        );

        let mut single_vars = HashMap::new();
        single_vars.insert("count", "1".to_string());
        let singular = engine
            .render(
                "pending_invites",
                NotificationChannel::InApp,
                "en",
                &single_vars,
                Some(1),
            )
            .unwrap();

        let mut plural_vars = HashMap::new();
        plural_vars.insert("count", "4".to_string());
        let plural = engine
            .render(
                "pending_invites",
                NotificationChannel::InApp,
                "en",
                &plural_vars,
                Some(4),
            )
            .unwrap();

        assert_eq!(singular.body, "You have 1 new invite.");
        assert_eq!(plural.body, "You have 4 new invites.");
    }
}