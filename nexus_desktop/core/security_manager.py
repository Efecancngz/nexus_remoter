import random
import string
import os

class SecurityManager:
    def __init__(self):
        # Generate new PIN on every startup (Dynamic)
        self.pin = self.generate_pin()

    def generate_pin(self):
        return "".join(random.choices(string.digits, k=4))

    def validate(self, incoming_pin):
        return incoming_pin == self.pin
