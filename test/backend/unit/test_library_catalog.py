"""slim_library_index keeps one latest row per library name."""

from app.services.arduino_cli import slim_library_index


def test_keeps_highest_version_and_sorts_by_name():
    rows = slim_library_index(
        [
            {"name": "Servo", "version": "1.1.8", "author": "Arduino", "sentence": "old", "category": "Device Control"},
            {"name": "Servo", "version": "1.2.1", "author": "Arduino", "sentence": "new", "category": "Device Control"},
            {"name": "Adafruit SSD1306", "version": "2.5.7", "author": "Adafruit", "sentence": "oled", "category": "Display"},
            {"name": "  ", "version": "1.0.0"},
            "not-a-dict",
        ]
    )
    assert [row["name"] for row in rows] == ["Adafruit SSD1306", "Servo"]
    servo = rows[1]
    assert servo["version"] == "1.2.1"
    assert servo["sentence"] == "new"


def test_numeric_version_not_string_order():
    rows = slim_library_index(
        [
            {"name": "Foo", "version": "1.9.0", "author": "", "sentence": "nine"},
            {"name": "Foo", "version": "1.10.0", "author": "", "sentence": "ten"},
        ]
    )
    assert rows[0]["version"] == "1.10.0"
    assert rows[0]["sentence"] == "ten"
