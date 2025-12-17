import difflib
from typing import Callable, Dict


def build_raw_diff(before_raw: str, after_raw: str, before_name: str, after_name: str) -> str:
    """Generate HTML diff table for provided contents."""
    diff_maker = difflib.HtmlDiff(wrapcolumn=120)
    return diff_maker.make_table(
        before_raw.splitlines(),
        after_raw.splitlines(),
        fromdesc=before_name,
        todesc=after_name,
        context=True,
        numlines=3
    )


def build_diff_payload(
    before_raw: str,
    after_raw: str,
    before_name: str,
    after_name: str,
    renderer: Callable[[str], str],
) -> Dict[str, dict]:
    """Build response payload for diff endpoints."""
    before_html = renderer(before_raw)
    after_html = renderer(after_raw)
    raw_diff_html = build_raw_diff(before_raw, after_raw, before_name, after_name)

    return {
        'before': {
            'filename': before_name,
            'raw_content': before_raw,
            'html_content': before_html
        },
        'after': {
            'filename': after_name,
            'raw_content': after_raw,
            'html_content': after_html
        },
        'raw_diff_html': raw_diff_html
    }

