"""
Convert sqlx::query! and query_as! macros to runtime queries across all affected files.
"""
import re
import os

BASE = r"c:\OPEN SOURCE\330+ backend\ArenaX\backend\src"

def convert_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    original = content
    
    # Convert sqlx::query_as!(Type, ...) to sqlx::query_as::<_, Type>(...)
    # Pattern: sqlx::query_as!(\n  Type,\n  "SQL",\n  binds...\n)
    content = convert_query_as_macros(content)
    
    # Convert sqlx::query!("SQL", binds...) to sqlx::query("SQL").bind(...)
    content = convert_query_macros(content)
    
    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"  Converted macros in {os.path.basename(filepath)}")
    else:
        print(f"  No macros found in {os.path.basename(filepath)}")

def convert_query_as_macros(content):
    """Convert sqlx::query_as!(Type, "SQL", binds...) to sqlx::query_as::<_, Type>("SQL").bind(...)"""
    # Find all query_as! macro invocations
    pattern = r'sqlx::query_as!\(\s*(\w+)\s*,\s*((?:"[^"]*"|r#"[^"]*"#))\s*((?:,\s*[^)]+?)?)\s*\)'
    
    def replacer(m):
        type_name = m.group(1)
        sql = m.group(2)
        binds_str = m.group(3).strip()
        
        # Parse binds
        binds = parse_binds(binds_str)
        
        result = f'sqlx::query_as::<_, {type_name}>({sql})'
        for bind in binds:
            result += f'\n        .bind({bind})'
        
        return result
    
    # More robust approach: find query_as! and match balanced parens
    result = []
    i = 0
    while i < len(content):
        # Look for sqlx::query_as!(
        idx = content.find('sqlx::query_as!(', i)
        if idx == -1:
            result.append(content[i:])
            break
        
        result.append(content[i:idx])
        
        # Find the matching closing paren
        start = idx + len('sqlx::query_as!(')
        paren_depth = 1
        j = start
        while j < len(content) and paren_depth > 0:
            if content[j] == '(':
                paren_depth += 1
            elif content[j] == ')':
                paren_depth -= 1
            j += 1
        
        inner = content[start:j-1]
        
        # Parse: TypeName, "SQL" or r#"SQL"#, bind1, bind2, ...
        type_name, sql, binds = parse_query_as_inner(inner)
        
        if type_name and sql:
            replacement = f'sqlx::query_as::<_, {type_name}>({sql})'
            for bind in binds:
                replacement += f'\n        .bind({bind})'
            result.append(replacement)
        else:
            # Couldn't parse, keep original
            result.append(content[idx:j])
        
        i = j
    
    return ''.join(result)

def convert_query_macros(content):
    """Convert sqlx::query!("SQL", binds...) to sqlx::query("SQL").bind(...)"""
    result = []
    i = 0
    while i < len(content):
        # Look for sqlx::query!( but NOT sqlx::query_as!(
        idx = content.find('sqlx::query!(', i)
        if idx == -1:
            result.append(content[i:])
            break
        
        # Make sure it's not query_as!
        if idx > 0 and content[max(0,idx-3):idx] == 'as!':
            result.append(content[i:idx+13])
            i = idx + 13
            continue
        
        result.append(content[i:idx])
        
        # Find the matching closing paren
        start = idx + len('sqlx::query!(')
        paren_depth = 1
        j = start
        while j < len(content) and paren_depth > 0:
            if content[j] == '(':
                paren_depth += 1
            elif content[j] == ')':
                paren_depth -= 1
            j += 1
        
        inner = content[start:j-1]
        
        # Parse: "SQL" or r#"SQL"#, bind1, bind2, ...
        sql, binds = parse_query_inner(inner)
        
        if sql:
            replacement = f'sqlx::query({sql})'
            for bind in binds:
                replacement += f'\n        .bind({bind})'
            result.append(replacement)
        else:
            # Couldn't parse, keep original
            result.append(content[idx:j])
        
        i = j
    
    return ''.join(result)

def parse_query_as_inner(inner):
    """Parse TypeName, SQL, binds from query_as! inner content"""
    inner = inner.strip()
    
    # Find type name (first identifier before comma)
    m = re.match(r'(\w+)\s*,\s*', inner)
    if not m:
        return None, None, []
    
    type_name = m.group(1)
    rest = inner[m.end():]
    
    # Now parse SQL and binds
    sql, binds = parse_sql_and_binds(rest)
    return type_name, sql, binds

def parse_query_inner(inner):
    """Parse SQL, binds from query! inner content"""
    inner = inner.strip()
    return parse_sql_and_binds(inner)

def parse_sql_and_binds(text):
    """Parse SQL string and bind parameters"""
    text = text.strip()
    
    # Handle r#"..."# raw strings
    if text.startswith('r#"'):
        end_idx = text.find('"#')
        if end_idx == -1:
            return None, []
        sql = text[:end_idx+2]
        rest = text[end_idx+2:].strip()
    # Handle regular strings
    elif text.startswith('"'):
        # Find the closing quote, handling escaped quotes
        idx = 1
        while idx < len(text):
            if text[idx] == '\\':
                idx += 2
                continue
            if text[idx] == '"':
                break
            idx += 1
        sql = text[:idx+1]
        rest = text[idx+1:].strip()
    else:
        return None, []
    
    # Parse binds (comma-separated after the SQL)
    binds = []
    if rest.startswith(','):
        rest = rest[1:].strip()
        binds = parse_binds(',' + rest) if rest else []
        # Actually, rest already has the comma stripped, let's parse directly
        binds = split_bind_args(rest)
    
    return sql, binds

def split_bind_args(text):
    """Split bind arguments respecting parentheses and angle brackets"""
    text = text.strip()
    if not text:
        return []
    
    args = []
    depth = 0
    current = []
    
    for ch in text:
        if ch in '(<[':
            depth += 1
            current.append(ch)
        elif ch in ')>]':
            depth -= 1
            current.append(ch)
        elif ch == ',' and depth == 0:
            arg = ''.join(current).strip()
            if arg:
                args.append(arg)
            current = []
        else:
            current.append(ch)
    
    arg = ''.join(current).strip()
    if arg:
        args.append(arg)
    
    return args

def parse_binds(text):
    """Parse comma-separated binds, handling nested expressions"""
    text = text.strip()
    if text.startswith(','):
        text = text[1:]
    return split_bind_args(text)

# Files to convert
files = [
    os.path.join(BASE, "http", "matchmaking.rs"),
    os.path.join(BASE, "http", "reputation_handler.rs"),
    os.path.join(BASE, "service", "matchmaker.rs"),
    os.path.join(BASE, "service", "reputation_service.rs"),
]

for f in files:
    if os.path.exists(f):
        print(f"Processing {os.path.basename(f)}...")
        convert_file(f)
    else:
        print(f"File not found: {f}")

print("\nDone! Now apply manual fixes.")
