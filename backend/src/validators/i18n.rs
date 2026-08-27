//! Error-message localization.
//!
//! [`localize_validation_errors`] turns a `validator::ValidationErrors` into a
//! JSON object of per-field, localized messages:
//!
//! ```json
//! {
//!   "username": ["Username must be 3-32 characters long"],
//!   "password": ["Password must contain at least one uppercase letter, one lowercase letter and one number"]
//! }
//! ```
//!
//! Supported locales: English (default), French, Spanish, German, Swahili and
//! Portuguese. Unknown codes fall back to English, then to a generic message,
//! so adding a new validator never breaks localization.

use std::borrow::Cow;
use std::collections::HashMap;

use serde_json::{Map, Value};
use validator::{Validate, ValidationError, ValidationErrors};

/// Locale used to render validation messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Locale {
    /// English (default fallback).
    En,
    /// French.
    Fr,
    /// Spanish.
    Es,
    /// German.
    De,
    /// Swahili.
    Sw,
    /// Portuguese.
    Pt,
}

impl Default for Locale {
    fn default() -> Self {
        Locale::En
    }
}

impl Locale {
    /// BCP-47-style tag for this locale, e.g. `"en"`, `"fr"`.
    pub fn as_str(&self) -> &'static str {
        match self {
            Locale::En => "en",
            Locale::Fr => "fr",
            Locale::Es => "es",
            Locale::De => "de",
            Locale::Sw => "sw",
            Locale::Pt => "pt",
        }
    }
}

impl std::str::FromStr for Locale {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "en" | "en-us" | "en-gb" => Ok(Locale::En),
            "fr" | "fr-fr" => Ok(Locale::Fr),
            "es" | "es-es" => Ok(Locale::Es),
            "de" | "de-de" => Ok(Locale::De),
            "sw" | "sw-ke" => Ok(Locale::Sw),
            "pt" | "pt-br" | "pt-pt" => Ok(Locale::Pt),
            _ => Err(()),
        }
    }
}

/// Message catalog: (code → template) per locale. Templates may reference
/// error params with `{name}` placeholders.
fn templates(locale: Locale) -> &'static [(&'static str, &'static str)] {
    match locale {
        Locale::En => &[
            ("required", "This field is required"),
            ("email", "Must be a valid email address"),
            ("url", "Must be a valid URL"),
            ("length", "Must be between {min} and {max} characters"),
            ("range", "Must be between {min} and {max}"),
            ("regex", "Does not match the required format"),
            ("custom", "Invalid value"),
            ("must_match", "Fields do not match"),
            ("contains", "Must contain a valid value"),
            ("does_not_contain", "Contains a value that is not allowed"),
            ("non_control_character", "Control characters are not allowed"),
            ("credit_card", "Must be a valid credit card number"),
            ("phone", "Must be a valid phone number"),
            ("json_schema", "Schema validation failed: {detail}"),
            ("username", "Username must be {min}-{max} characters long"),
            ("username_charset", "Username may only contain letters, numbers, '_', '-' and '.'"),
            ("password", "Password must be {min}-{max} characters long"),
            ("password_complexity", "Password must contain at least one uppercase letter, one lowercase letter and one number"),
            ("uuid", "Must be a valid UUID"),
            ("currency", "Must be a valid currency code (3-10 letters/digits)"),
            ("stellar_address", "Must be a valid Stellar address (56 characters)"),
            ("phone_number", "Must be a valid phone number (7-15 digits, optional '+')"),
            ("safe_string_length", "Must be at most {max} characters"),
            ("safe_string_control", "Control characters are not allowed"),
            ("positive_amount", "Amount must be greater than zero"),
            ("reference", "Must be a valid reference ({min}-{max} characters, letters/digits/'_'/'-')"),
            ("unique", "This value is already taken"),
            ("schema", "Invalid schema: {detail}"),
        ],
        Locale::Fr => &[
            ("required", "Ce champ est requis"),
            ("email", "Doit être une adresse e-mail valide"),
            ("url", "Doit être une URL valide"),
            ("length", "Doit contenir entre {min} et {max} caractères"),
            ("range", "Doit être entre {min} et {max}"),
            ("regex", "Ne correspond pas au format requis"),
            ("custom", "Valeur invalide"),
            ("must_match", "Les champs ne correspondent pas"),
            ("contains", "Doit contenir une valeur valide"),
            ("does_not_contain", "Contient une valeur non autorisée"),
            ("non_control_character", "Les caractères de contrôle ne sont pas autorisés"),
            ("credit_card", "Doit être un numéro de carte bancaire valide"),
            ("phone", "Doit être un numéro de téléphone valide"),
            ("json_schema", "Échec de la validation du schéma : {detail}"),
            ("username", "Le nom d'utilisateur doit contenir entre {min} et {max} caractères"),
            ("username_charset", "Le nom d'utilisateur ne peut contenir que des lettres, des chiffres, '_', '-' et '.'"),
            ("password", "Le mot de passe doit contenir entre {min} et {max} caractères"),
            ("password_complexity", "Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre"),
            ("uuid", "Doit être un UUID valide"),
            ("currency", "Doit être un code de devise valide (3-10 lettres/chiffres)"),
            ("stellar_address", "Doit être une adresse Stellar valide (56 caractères)"),
            ("phone_number", "Doit être un numéro de téléphone valide (7-15 chiffres, '+' optionnel)"),
            ("safe_string_length", "Doit contenir au maximum {max} caractères"),
            ("safe_string_control", "Les caractères de contrôle ne sont pas autorisés"),
            ("positive_amount", "Le montant doit être supérieur à zéro"),
            ("reference", "Doit être une référence valide ({min}-{max} caractères, lettres/chiffres/'_'/'-')"),
            ("unique", "Cette valeur est déjà prise"),
            ("schema", "Schéma invalide : {detail}"),
        ],
        Locale::Es => &[
            ("required", "Este campo es obligatorio"),
            ("email", "Debe ser un correo electrónico válido"),
            ("url", "Debe ser una URL válida"),
            ("length", "Debe tener entre {min} y {max} caracteres"),
            ("range", "Debe estar entre {min} y {max}"),
            ("regex", "No coincide con el formato requerido"),
            ("custom", "Valor no válido"),
            ("must_match", "Los campos no coinciden"),
            ("contains", "Debe contener un valor válido"),
            ("does_not_contain", "Contiene un valor no permitido"),
            ("non_control_character", "No se permiten caracteres de control"),
            ("credit_card", "Debe ser un número de tarjeta de crédito válido"),
            ("phone", "Debe ser un número de teléfono válido"),
            ("json_schema", "Falló la validación del esquema: {detail}"),
            ("username", "El nombre de usuario debe tener entre {min} y {max} caracteres"),
            ("username_charset", "El nombre de usuario solo puede contener letras, números, '_', '-' y '.'"),
            ("password", "La contraseña debe tener entre {min} y {max} caracteres"),
            ("password_complexity", "La contraseña debe contener al menos una mayúscula, una minúscula y un número"),
            ("uuid", "Debe ser un UUID válido"),
            ("currency", "Debe ser un código de moneda válido (3-10 letras/dígitos)"),
            ("stellar_address", "Debe ser una dirección Stellar válida (56 caracteres)"),
            ("phone_number", "Debe ser un número de teléfono válido (7-15 dígitos, '+' opcional)"),
            ("safe_string_length", "Debe tener como máximo {max} caracteres"),
            ("safe_string_control", "No se permiten caracteres de control"),
            ("positive_amount", "El importe debe ser mayor que cero"),
            ("reference", "Debe ser una referencia válida ({min}-{max} caracteres, letras/dígitos/'_'/'-')"),
            ("unique", "Este valor ya está en uso"),
            ("schema", "Esquema no válido: {detail}"),
        ],
        Locale::De => &[
            ("required", "Dieses Feld ist erforderlich"),
            ("email", "Muss eine gültige E-Mail-Adresse sein"),
            ("url", "Muss eine gültige URL sein"),
            ("length", "Muss zwischen {min} und {max} Zeichen lang sein"),
            ("range", "Muss zwischen {min} und {max} liegen"),
            ("regex", "Entspricht nicht dem erforderlichen Format"),
            ("custom", "Ungültiger Wert"),
            ("must_match", "Die Felder stimmen nicht überein"),
            ("contains", "Muss einen gültigen Wert enthalten"),
            ("does_not_contain", "Enthält einen unzulässigen Wert"),
            ("non_control_character", "Steuerzeichen sind nicht erlaubt"),
            ("credit_card", "Muss eine gültige Kreditkartennummer sein"),
            ("phone", "Muss eine gültige Telefonnummer sein"),
            ("json_schema", "Schema-Validierung fehlgeschlagen: {detail}"),
            ("username", "Der Benutzername muss {min}-{max} Zeichen lang sein"),
            ("username_charset", "Der Benutzername darf nur Buchstaben, Ziffern, '_', '-' und '.' enthalten"),
            ("password", "Das Passwort muss {min}-{max} Zeichen lang sein"),
            ("password_complexity", "Das Passwort muss mindestens einen Großbuchstaben, einen Kleinbuchstaben und eine Ziffer enthalten"),
            ("uuid", "Muss eine gültige UUID sein"),
            ("currency", "Muss ein gültiger Währungscode sein (3-10 Buchstaben/Ziffern)"),
            ("stellar_address", "Muss eine gültige Stellar-Adresse sein (56 Zeichen)"),
            ("phone_number", "Muss eine gültige Telefonnummer sein (7-15 Ziffern, '+' optional)"),
            ("safe_string_length", "Darf höchstens {max} Zeichen lang sein"),
            ("safe_string_control", "Steuerzeichen sind nicht erlaubt"),
            ("positive_amount", "Der Betrag muss größer als null sein"),
            ("reference", "Muss eine gültige Referenz sein ({min}-{max} Zeichen, Buchstaben/Ziffern/'_'/'-')"),
            ("unique", "Dieser Wert ist bereits vergeben"),
            ("schema", "Ungültiges Schema: {detail}"),
        ],
        Locale::Sw => &[
            ("required", "Sehemu hii inahitajika"),
            ("email", "Lazima iwe anwani halali ya barua pepe"),
            ("url", "Lazima iwe URL halali"),
            ("length", "Lazima iwe na herufi {min} hadi {max}"),
            ("range", "Lazima iwe kati ya {min} na {max}"),
            ("regex", "Haifai na umbizo linalohitajika"),
            ("custom", "Thamani batili"),
            ("must_match", "Sehemu hazilingani"),
            ("contains", "Lazima iwe na thamani halali"),
            ("does_not_contain", "Ina thamani isiyoruhusiwa"),
            ("non_control_character", "Herufi za kudhibiti haziruhusiwi"),
            ("credit_card", "Lazima iwe nambari halali ya kadi ya mkopo"),
            ("phone", "Lazima iwe nambari halali ya simu"),
            ("json_schema", "Uthibitishaji wa schema umeshindikana: {detail}"),
            ("username", "Jina la mtumiaji lazima liwe na herufi {min} hadi {max}"),
            ("username_charset", "Jina la mtumiaji linaweza kuwa na herufi, nambari, '_', '-' na '.' pekee"),
            ("password", "Nenosiri lazima liwe na herufi {min} hadi {max}"),
            ("password_complexity", "Nenosiri lazima liwe na angalau herufi kubwa moja, herufi ndogo moja na nambari moja"),
            ("uuid", "Lazima iwe UUID halali"),
            ("currency", "Lazima iwe msimbo halali wa sarafu (herufi/nambari 3-10)"),
            ("stellar_address", "Lazima iwe anwani halali ya Stellar (herufi 56)"),
            ("phone_number", "Lazima iwe nambari halali ya simu (nambari 7-15, '+' hiari)"),
            ("safe_string_length", "Lazima iwe na angalau herufi {max}"),
            ("safe_string_control", "Herufi za kudhibiti haziruhusiwi"),
            ("positive_amount", "Kiasi lazima kiwe kikubwa kuliko sifuri"),
            ("reference", "Lazima iwe rejeleo halali ({min}-{max} herufi, herufi/nambari/'_'/'-')"),
            ("unique", "Thamani hii tayari imechukuliwa"),
            ("schema", "Schema batili: {detail}"),
        ],
        Locale::Pt => &[
            ("required", "Este campo é obrigatório"),
            ("email", "Deve ser um e-mail válido"),
            ("url", "Deve ser uma URL válida"),
            ("length", "Deve ter entre {min} e {max} caracteres"),
            ("range", "Deve estar entre {min} e {max}"),
            ("regex", "Não corresponde ao formato exigido"),
            ("custom", "Valor inválido"),
            ("must_match", "Os campos não coincidem"),
            ("contains", "Deve conter um valor válido"),
            ("does_not_contain", "Contém um valor não permitido"),
            ("non_control_character", "Caracteres de controle não são permitidos"),
            ("credit_card", "Deve ser um número de cartão de crédito válido"),
            ("phone", "Deve ser um número de telefone válido"),
            ("json_schema", "Falha na validação do schema: {detail}"),
            ("username", "O nome de usuário deve ter {min}-{max} caracteres"),
            ("username_charset", "O nome de usuário só pode conter letras, números, '_', '-' e '.'"),
            ("password", "A senha deve ter {min}-{max} caracteres"),
            ("password_complexity", "A senha deve conter pelo menos uma letra maiúscula, uma minúscula e um número"),
            ("uuid", "Deve ser um UUID válido"),
            ("currency", "Deve ser um código de moeda válido (3-10 letras/dígitos)"),
            ("stellar_address", "Deve ser um endereço Stellar válido (56 caracteres)"),
            ("phone_number", "Deve ser um número de telefone válido (7-15 dígitos, '+' opcional)"),
            ("safe_string_length", "Deve ter no máximo {max} caracteres"),
            ("safe_string_control", "Caracteres de controle não são permitidos"),
            ("positive_amount", "O valor deve ser maior que zero"),
            ("reference", "Deve ser uma referência válida ({min}-{max} caracteres, letras/dígitos/'_'/'-')"),
            ("unique", "Este valor já está em uso"),
            ("schema", "Schema inválido: {detail}"),
        ],
    }
}

/// Look up the template for `code` in `locale`, falling back to English and
/// finally to a generic message.
fn message(locale: Locale, code: &str) -> &'static str {
    templates(locale)
        .iter()
        .find(|(c, _)| *c == code)
        .map(|(_, m)| *m)
        .or_else(|| {
            templates(Locale::En)
                .iter()
                .find(|(c, _)| *c == code)
                .map(|(_, m)| *m)
        })
        .unwrap_or("Invalid value")
}

/// Replace `{name}` placeholders with error params and drop any leftovers.
fn interpolate(template: &str, params: &HashMap<Cow<'static, str>, Value>) -> String {
    let mut out = template.to_string();
    for (key, value) in params {
        let placeholder = format!("{{{}}}", key);
        match value {
            Value::String(s) => out = out.replace(&placeholder, s),
            Value::Number(n) => out = out.replace(&placeholder, &n.to_string()),
            Value::Bool(b) => out = out.replace(&placeholder, &b.to_string()),
            // Null params (e.g. an unset min/max) simply remove the placeholder.
            _ => out = out.replace(&placeholder, ""),
        }
    }
    strip_remaining_placeholders(&out)
}

/// Remove any `{...}` tokens left over from params the template did not use.
fn strip_remaining_placeholders(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '{' {
            // Consume until the closing brace (or end of string).
            let mut rest = String::new();
            let mut closed = false;
            for next in chars.by_ref() {
                if next == '}' {
                    closed = true;
                    break;
                }
                rest.push(next);
            }
            if !closed {
                // Unterminated — keep the literal '{' and what followed.
                out.push('{');
                out.push_str(&rest);
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Localize a single validation error.
pub fn localize_validation_error(error: &ValidationError, locale: Locale) -> String {
    interpolate(message(locale, error.code.as_ref()), &error.params)
}

/// Localize a full set of validation errors into a JSON object keyed by field.
///
/// The shape is `{ "<field>": ["<localized message>", ...], ... }`, ready to be
/// embedded in an API error response.
pub fn localize_validation_errors(errors: &ValidationErrors, locale: Locale) -> Value {
    let mut map = Map::new();
    for (field, field_errors) in errors.errors() {
        let messages: Vec<Value> = field_errors
            .iter()
            .map(|e| Value::String(localize_validation_error(e, locale)))
            .collect();
        map.insert((*field).to_string(), Value::Array(messages));
    }
    Value::Object(map)
}

/// Validate a DTO and localize any errors in one call.
///
/// Returns `Ok(())` or the localized error map.
pub fn validate_and_localize<T: Validate>(value: &T, locale: Locale) -> Result<(), Value> {
    match value.validate() {
        Ok(()) => Ok(()),
        Err(errors) => Err(localize_validation_errors(&errors, locale)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn localizes_derive_length_errors() {
        #[derive(Validate)]
        struct Input {
            #[validate(length(min = 3, max = 5))]
            name: String,
        }

        let input = Input {
            name: "ab".to_string(),
        };
        let errors = input.validate().unwrap_err();

        let en = localize_validation_errors(&errors, Locale::En);
        let fr = localize_validation_errors(&errors, Locale::Fr);
        let es = localize_validation_errors(&errors, Locale::Es);

        let en_msg = en["name"][0].as_str().unwrap();
        let fr_msg = fr["name"][0].as_str().unwrap();
        let es_msg = es["name"][0].as_str().unwrap();

        assert!(en_msg.contains("3") && en_msg.contains("5"));
        assert!(fr_msg.contains("3") && fr_msg.contains("5"));
        assert_ne!(en_msg, fr_msg);
        assert_ne!(en_msg, es_msg);
    }

    #[test]
    fn localizes_custom_validator_codes() {
        let err = crate::validators::custom::validate_username("x").unwrap_err();
        let fr = localize_validation_error(&err, Locale::Fr);
        assert!(fr.contains("3") && fr.contains("32"));
        assert!(fr.contains("utilisateur"));

        let err = crate::validators::custom::validate_password("weak").unwrap_err();
        let de = localize_validation_error(&err, Locale::De);
        assert!(de.contains("Passwort"));

        let err = crate::validators::custom::validate_positive_amount(0).unwrap_err();
        let sw = localize_validation_error(&err, Locale::Sw);
        assert!(sw.contains("sifuri"));
    }

    #[test]
    fn unknown_codes_fall_back_to_english_then_generic() {
        let err = ValidationError::new("some_unknown_code");
        assert_eq!(
            localize_validation_error(&err, Locale::Fr),
            "Invalid value"
        );
    }

    #[test]
    fn json_schema_errors_include_detail() {
        let mut err = ValidationError::new("json_schema");
        err.add_param(Cow::from("detail"), &"\"oops\" is not of type \"integer\"");
        let msg = localize_validation_error(&err, Locale::En);
        assert!(msg.contains("oops"));
    }

    #[test]
    fn null_params_do_not_leave_placeholders() {
        // A length error with only `min` set leaves `max` unset (null).
        #[derive(Validate)]
        struct Input {
            #[validate(length(min = 3))]
            name: String,
        }
        let input = Input {
            name: "ab".to_string(),
        };
        let errors = input.validate().unwrap_err();
        let localized = localize_validation_errors(&errors, Locale::En);
        let msg = localized["name"][0].as_str().unwrap();
        assert!(!msg.contains('{'), "leftover placeholder in: {}", msg);
        assert!(msg.contains("3"));
    }

    #[test]
    fn validate_and_localize_returns_json() {
        #[derive(Validate)]
        struct Input {
            #[validate(email)]
            email: String,
        }
        let input = Input {
            email: "not-an-email".to_string(),
        };
        let localized = validate_and_localize(&input, Locale::En).unwrap_err();
        assert!(localized["email"][0].as_str().unwrap().contains("email"));

        let ok = Input {
            email: "player@example.com".to_string(),
        };
        assert!(validate_and_localize(&ok, Locale::En).is_ok());
    }

    #[test]
    fn locale_parsing() {
        assert_eq!("fr".parse::<Locale>().unwrap(), Locale::Fr);
        assert_eq!("pt-BR".parse::<Locale>().unwrap(), Locale::Pt);
        assert_eq!("en-GB".parse::<Locale>().unwrap(), Locale::En);
        assert!("xx".parse::<Locale>().is_err());
        assert_eq!(Locale::default(), Locale::En);
        assert_eq!(Locale::Sw.as_str(), "sw");
    }
}
